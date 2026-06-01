import crypto from "node:crypto";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const PROTOCOL_VERSION = "pact.external-knowledge-distillation.v1";
const SERVICE_NAME = "external-knowledge-distillation";
const SERVICE_KIND = "externalKnowledgeDistillation";
const PORT = Number(process.env.PORT || process.env.SERVICE_PORT || 8799);
const HOST = String(process.env.HOST || process.env.SERVICE_HOST || "0.0.0.0");
const DATA_DIR = path.resolve(process.env.SERVICE_DATA_DIR || "/data");
const RUNS_PATH = path.join(DATA_DIR, "runs.json");
const SERVICE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SERVICE_ROOT, "../..");
const REFERENCE_FRAMEWORKS_PATH = path.join(SERVICE_ROOT, "reference-frameworks.json");
const INPUT_ROOTS = Array.from(new Set([
  DATA_DIR,
  ...String(process.env.PACT_EXTERNAL_KD_INPUT_ROOTS || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
].map((item) => path.resolve(item))));
const DEFAULT_WINDOW_CHARACTERS = 12_000;
const DEFAULT_WINDOW_OVERLAP_CHARACTERS = 600;
const LARGE_FILE_BYTES = 50 * 1024 * 1024;
const LARGE_TEXT_CHARACTERS = 1_000_000;
const FILE_REF_DIRECT_READ_MAX_BYTES = Math.max(1024, Number(process.env.PACT_EXTERNAL_KD_FILE_REF_DIRECT_READ_MAX_BYTES || 8 * 1024 * 1024));
const STREAM_TEXT_CHUNK_BYTES = Math.max(4096, Number(process.env.PACT_EXTERNAL_KD_STREAM_TEXT_CHUNK_BYTES || 512 * 1024));
const STREAM_TEXT_SAMPLE_CHARACTERS = Math.max(1024, Number(process.env.PACT_EXTERNAL_KD_STREAM_TEXT_SAMPLE_CHARACTERS || 200_000));
const BINARY_PROFILE_SAMPLE_BYTES = Math.max(512, Number(process.env.PACT_EXTERNAL_KD_BINARY_PROFILE_SAMPLE_BYTES || 4096));
const SIGNATURE_SNIFF_BYTES = Math.max(4096, Number(process.env.PACT_EXTERNAL_KD_SIGNATURE_SNIFF_BYTES || 256 * 1024));
const EMBEDDING_DIMENSIONS = 128;
const LEADER_CLUSTER_THRESHOLD = 0.34;
const WINDOW_COMMUNITY_CLUSTER_THRESHOLD = 0.31;
const CROSS_TOPIC_LINK_THRESHOLD = 0.58;
const CLASSIFICATION_SEPARATION_THRESHOLD = 0.42;
const GARBAGE_SIGNAL_THRESHOLD = 0.18;
const GROUNDING_SUPPORT_THRESHOLD = 0.42;
const GROUNDING_CONFLICT_THRESHOLD = 0.48;
const CLASSIFICATION_STRATEGY = "hashing_embedding_window_community_classification_v3";
const GROUNDING_STRATEGY = "claim-evidence-topk-conflict-gating.v2";
const INCREMENTAL_CONVERGENCE_STRATEGY = "project-snapshot-incremental-convergence.v1";
const GRAPH_EVIDENCE_STRATEGY = "graph-lite-entity-relationship-evidence-pack.v1";
const EVIDENCE_QUERY_STRATEGY = "graph-lite-evidence-query.v1";
const PROJECT_CONVERGENCE_STRATEGY = "hierarchical-domain-topic-project-convergence.v3";
const PROJECT_EVIDENCE_QUERY_STRATEGY = "project-graph-evidence-convergence-query.v1";
const REFERENCE_GAP_REPORT_STRATEGY = "reference-framework-gap-report.v1";
const REFERENCE_FRAMEWORK_AUDIT_STRATEGY = "reference-framework-local-checkout-audit.v1";
const PDF_SUBTYPE_ROUTING_STRATEGY = "pdf-subtype-routing.v1";
const DISTILLATION_DOCUMENT_INPUT_CONTRACT = "pact.normalized-distillation-documents.v1";
const DOCUMENT_INGESTION_ADAPTER_STRATEGY = "external-kd.document-ingestion-adapter.v1";
const DISTILLATION_ALGORITHM_INPUT_CONTRACT = "external-kd.algorithm-input.normalized-documents.v1";
const DOCUMENT_PARSING_MODULE_BOUNDARY = "external-kd.document-parsing.module.v1";
const DISTILLATION_ALGORITHM_MODULE_BOUNDARY = "external-kd.distillation-algorithm.module.v1";
const MODEL_DISTILLATION_MODULE_BOUNDARY = "external-kd.model-distillation.module.v1";
const FORMAT_CONVERSION_MODULE_BOUNDARY = "external-kd.format-conversion.module.v1";
const MODEL_DISTILLATION_GATEWAY_STRATEGY = "required-agent-gateway-real-model-call.v1";
const DISTILLATION_WORKFLOW_SCOPE = Object.freeze({
  DOCUMENT: "document",
  CORPUS: "corpus",
  PROJECT: "project"
});
const DISTILLATION_WORKFLOW_SCOPE_VALUES = Object.freeze(Object.values(DISTILLATION_WORKFLOW_SCOPE));
const DEFAULT_DISTILLATION_WORKFLOW_SCOPE = DISTILLATION_WORKFLOW_SCOPE.PROJECT;
const DISTILLATION_WORKFLOW_SCOPE_ALIASES = Object.freeze({
  doc: DISTILLATION_WORKFLOW_SCOPE.DOCUMENT,
  document: DISTILLATION_WORKFLOW_SCOPE.DOCUMENT,
  single: DISTILLATION_WORKFLOW_SCOPE.DOCUMENT,
  "single-document": DISTILLATION_WORKFLOW_SCOPE.DOCUMENT,
  source: DISTILLATION_WORKFLOW_SCOPE.DOCUMENT,
  corpus: DISTILLATION_WORKFLOW_SCOPE.CORPUS,
  batch: DISTILLATION_WORKFLOW_SCOPE.CORPUS,
  collection: DISTILLATION_WORKFLOW_SCOPE.CORPUS,
  "multi-document": DISTILLATION_WORKFLOW_SCOPE.CORPUS,
  project: DISTILLATION_WORKFLOW_SCOPE.PROJECT,
  "project-run": DISTILLATION_WORKFLOW_SCOPE.PROJECT
});
const RUNTIME_DOCTOR_TIMEOUT_MS = 2500;
const RUNTIME_DOCTOR_CACHE_MS = 30_000;
const OCR_TIMEOUT_MS = Number(process.env.PACT_EXTERNAL_KD_OCR_TIMEOUT_MS || 30_000);
const PDF_OCR_MAX_PAGES = Number(process.env.PACT_EXTERNAL_KD_PDF_OCR_MAX_PAGES || 5);
const TIKA_APP_JAR = process.env.TIKA_APP_JAR || "/opt/tika/tika-app.jar";
const TIKA_TIMEOUT_MS = Number(process.env.PACT_EXTERNAL_KD_TIKA_TIMEOUT_MS || 60_000);
const ARCHIVE_EXPANSION_MAX_DEPTH = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_ARCHIVE_EXPANSION_MAX_DEPTH || 3));
const ARCHIVE_EXPANSION_MAX_ENTRIES = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_ARCHIVE_EXPANSION_MAX_ENTRIES || 500));
const ARCHIVE_ENTRY_MAX_BYTES = Math.max(1024, Number(process.env.PACT_EXTERNAL_KD_ARCHIVE_ENTRY_MAX_BYTES || 25 * 1024 * 1024));
const ARCHIVE_EXTERNAL_TIMEOUT_MS = Number(process.env.PACT_EXTERNAL_KD_ARCHIVE_EXTERNAL_TIMEOUT_MS || 45_000);
const DIRECTORY_EXPANSION_MAX_DEPTH = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_DIRECTORY_EXPANSION_MAX_DEPTH || 8));
const DIRECTORY_EXPANSION_MAX_FILES = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_DIRECTORY_EXPANSION_MAX_FILES || 5000));
const MANIFEST_MAX_DOCUMENTS = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_MANIFEST_MAX_DOCUMENTS || 100_000));
const MANIFEST_JSON_DIRECT_READ_MAX_BYTES = Math.max(1024, Number(process.env.PACT_EXTERNAL_KD_MANIFEST_JSON_DIRECT_READ_MAX_BYTES || FILE_REF_DIRECT_READ_MAX_BYTES));
const EMAIL_ATTACHMENT_MAX_COUNT = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_EMAIL_ATTACHMENT_MAX_COUNT || 200));
const EMAIL_ATTACHMENT_MAX_BYTES = Math.max(1024, Number(process.env.PACT_EXTERNAL_KD_EMAIL_ATTACHMENT_MAX_BYTES || 25 * 1024 * 1024));
const EMAIL_MIME_MAX_DEPTH = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_EMAIL_MIME_MAX_DEPTH || 8));
const EMAIL_MBOX_MAX_MESSAGES = Math.max(1, Number(process.env.PACT_EXTERNAL_KD_EMAIL_MBOX_MAX_MESSAGES || 500));
const EMAIL_MBOX_MESSAGE_MAX_CHARACTERS = Math.max(4096, Number(process.env.PACT_EXTERNAL_KD_EMAIL_MBOX_MESSAGE_MAX_CHARACTERS || 25 * 1024 * 1024));
const STRUCTURED_ZIP_ENTRY_MAX_BYTES = Math.max(1024, Number(process.env.PACT_EXTERNAL_KD_STRUCTURED_ZIP_ENTRY_MAX_BYTES || ARCHIVE_ENTRY_MAX_BYTES));
const MODEL_GATEWAY_TIMEOUT_MS = Math.max(1000, Number(process.env.PACT_EXTERNAL_KD_MODEL_GATEWAY_TIMEOUT_MS || 120_000));
const MODEL_DISTILLATION_PROMPT_MAX_CHARACTERS = Math.max(4096, Number(process.env.PACT_EXTERNAL_KD_MODEL_PROMPT_MAX_CHARACTERS || 48_000));
let runtimeDoctorCache = null;
const PARSER_PAYLOAD_FIELD_NAMES = Object.freeze([
  "archiveFilePath",
  "directoryPath",
  "pdfFilePath",
  "structuredZipFilePath",
  "mboxFilePath",
  "tikaFilePath",
  "binaryProfileFilePath",
  "filePath",
  "contentRef",
  "contentBase64",
  "dataBase64",
  "base64",
  "buffer",
  "rawBuffer",
  "imageDataUrl"
]);
const STOP_WORDS = new Set([
  "about",
  "after",
  "and",
  "are",
  "from",
  "have",
  "into",
  "that",
  "the",
  "this",
  "with",
  "为",
  "和",
  "与",
  "及",
  "是",
  "的",
  "了",
  "在",
  "对",
  "中"
]);

const SEMANTIC_ALIAS_GROUPS = Object.freeze({
  architecture: [
    "api",
    "apis",
    "namespace",
    "platform",
    "service",
    "services",
    "contract",
    "contracts",
    "capability",
    "capabilities",
    "registration",
    "registry"
  ],
  finance: [
    "finance",
    "financial",
    "currency",
    "currencies",
    "invoice",
    "invoices",
    "vendor",
    "vendors",
    "supplier",
    "suppliers",
    "payment",
    "payments",
    "remittance",
    "settlement",
    "settlements",
    "tax",
    "vat",
    "total",
    "totals",
    "amount",
    "amounts",
    "revenue",
    "revenues",
    "income",
    "loss",
    "operating",
    "gaap",
    "usd",
    "xbrl",
    "ixbrl"
  ],
  parsing: [
    "parser",
    "parsers",
    "parse",
    "parsing",
    "route",
    "routing",
    "fallback",
    "fallbacks",
    "tika",
    "docx",
    "pdf",
    "ocr",
    "payload",
    "base64",
    "markdown",
    "json",
    "csv",
    "zip",
    "ooxml"
  ],
  visual: [
    "image",
    "images",
    "screenshot",
    "screenshots",
    "capture",
    "ocr",
    "visual",
    "page",
    "pages",
    "layout"
  ],
  project: [
    "project",
    "projects",
    "engineering",
    "deployment",
    "manual",
    "evidence",
    "window",
    "windows",
    "convergence",
    "distillation"
  ]
});

const DOMAIN_SEMANTIC_CONCEPTS = Object.freeze(new Set([
  "architecture",
  "finance"
]));

const BROAD_SEMANTIC_CONCEPTS = Object.freeze(new Set([
  "project"
]));

const MECHANICAL_SEMANTIC_CONCEPTS = Object.freeze(new Set([
  "parsing",
  "visual"
]));

const ROUTE_CONCEPT_BOOSTS = Object.freeze({
  "financial-report": { finance: 4 },
  spreadsheet: { finance: 0.75 },
  email: { finance: 0.25 },
  archive: { parsing: 0.25 },
  directory: { project: 2 },
  image: { visual: 2 },
  "scanned-document": { visual: 1.5 },
  audio: { parsing: 0.25 },
  transcript: { parsing: 0.25 }
});

const DIRECTORY_IGNORED_NAMES = Object.freeze(new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  ".yarn",
  "__pycache__",
  "build",
  "DerivedData",
  "dist",
  "node_modules",
  "target",
  "venv"
]));
const SEMANTIC_CONCEPT_INDEX = Object.freeze(
  Object.fromEntries(Object.keys(SEMANTIC_ALIAS_GROUPS).map((concept, index) => [`concept:${concept}`, index]))
);

const FORMAT_ROUTES_CONFIG_PATH = path.join(SERVICE_ROOT, "format-routes.json");
const FORMAT_ROUTES_CONFIG_PROTOCOL_VERSION = "pact.external-knowledge-distillation.format-routes.v1";
const FORMAT_ROUTES_CONFIG_STRATEGY = "singleton-format-route-registry.v1";

function normalizeFormatRouteArray(value = []) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)));
}

function normalizeFormatRouteExtensionArray(value = []) {
  return normalizeFormatRouteArray(value).map(normalizeExtension).filter(Boolean);
}

function normalizeFormatRouteMediaTypeArray(value = []) {
  return normalizeFormatRouteArray(value).map((item) => item.toLowerCase());
}

function validateFormatRoutesConfig(config = {}) {
  if (config.protocolVersion !== FORMAT_ROUTES_CONFIG_PROTOCOL_VERSION) {
    throw new Error(`Invalid format route config protocolVersion: ${config.protocolVersion || "missing"}`);
  }
  if (config.strategy !== FORMAT_ROUTES_CONFIG_STRATEGY) {
    throw new Error(`Invalid format route config strategy: ${config.strategy || "missing"}`);
  }
  if (!Array.isArray(config.routes) || config.routes.length === 0) {
    throw new Error("format-routes.json must contain non-empty routes[]");
  }
  const routeIds = new Set();
  const extensions = new Set();
  const mediaTypes = new Set();
  for (const [index, route] of config.routes.entries()) {
    const id = String(route?.id || "").trim();
    if (!id) {
      throw new Error(`format route at index ${index} is missing id`);
    }
    if (routeIds.has(id)) {
      throw new Error(`Duplicate format route id: ${id}`);
    }
    routeIds.add(id);
    for (const field of ["label", "contentShape", "preferredParser", "streamingUnit"]) {
      if (!String(route?.[field] || "").trim()) {
        throw new Error(`format route ${id} is missing ${field}`);
      }
    }
    if (!Array.isArray(route.extensions) || route.extensions.length === 0) {
      throw new Error(`format route ${id} must define extensions[]`);
    }
    if (!Array.isArray(route.parserChain) || route.parserChain.length === 0) {
      throw new Error(`format route ${id} must define parserChain[]`);
    }
    for (const extension of normalizeFormatRouteExtensionArray(route.extensions)) {
      if (extensions.has(extension)) {
        throw new Error(`Duplicate format route extension: ${extension}`);
      }
      extensions.add(extension);
    }
    for (const mediaType of normalizeFormatRouteMediaTypeArray(route.mediaTypes)) {
      if (mediaTypes.has(mediaType)) {
        throw new Error(`Duplicate format route media type: ${mediaType}`);
      }
      mediaTypes.add(mediaType);
    }
  }
  return {
    routeCount: routeIds.size,
    extensionCount: extensions.size,
    mediaTypeCount: mediaTypes.size
  };
}

function loadFormatRoutes() {
  const parsed = JSON.parse(fsSync.readFileSync(FORMAT_ROUTES_CONFIG_PATH, "utf8"));
  const summary = validateFormatRoutesConfig(parsed);
  return Object.freeze(parsed.routes.map((route) => Object.freeze({
    id: String(route.id || "").trim(),
    label: String(route.label || "").trim(),
    extensions: Object.freeze(normalizeFormatRouteExtensionArray(route.extensions)),
    mediaTypes: Object.freeze(normalizeFormatRouteMediaTypeArray(route.mediaTypes)),
    contentShape: String(route.contentShape || "").trim(),
    preferredParser: String(route.preferredParser || "").trim(),
    fallbackParsers: Object.freeze(normalizeFormatRouteArray(route.fallbackParsers)),
    parserChain: Object.freeze(normalizeFormatRouteArray(route.parserChain)),
    streamingUnit: String(route.streamingUnit || "").trim(),
    referenceFrameworks: Object.freeze(normalizeFormatRouteArray(route.referenceFrameworks)),
    registry: Object.freeze({
      protocolVersion: FORMAT_ROUTES_CONFIG_PROTOCOL_VERSION,
      strategy: FORMAT_ROUTES_CONFIG_STRATEGY,
      source: "external-services/knowledge-distillation-service/format-routes.json",
      routeCount: summary.routeCount,
      extensionCount: summary.extensionCount,
      mediaTypeCount: summary.mediaTypeCount
    })
  })));
}

const FORMAT_ROUTES = loadFormatRoutes();

const ROUTES_BY_EXTENSION = new Map();
const ROUTES_BY_MEDIA_TYPE = new Map();
for (const route of FORMAT_ROUTES) {
  for (const extension of route.extensions) {
    ROUTES_BY_EXTENSION.set(extension, route);
  }
  for (const mediaType of route.mediaTypes) {
    ROUTES_BY_MEDIA_TYPE.set(mediaType, route);
  }
}

const PROFESSIONAL_FORMAT_ORDER = Object.freeze(["pdf", "word", "presentation", "visio", "spreadsheet", "markdown", "open-document"]);
const PROFESSIONAL_FORMAT_ADAPTERS = Object.freeze({
  pdf: {
    label: "PDF",
    professionalFamily: "pdf",
    parserProfile: "pdf.text-layout-ocr-route",
    structureUnits: ["page", "pdf-text-block", "layout-run", "link", "pdf-outline", "pdf-form-field", "ocr-page"],
    parserStages: ["pdf.text.basic", "pdf.text.pdftotext", "pdf.hyperlinks", "pdf.outlines", "pdf.form-fields", "pdf.visual.layout", "ocr.page"],
    preserves: ["page", "bbox", "layout.order", "layout.fontSize", "links", "outline", "formFields"],
    conversionTargets: ["markdown-with-page-blocks", "docx-review-copy", "agent-json-with-layout-and-link-refs", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "pdf-pages-to-markdown.v1",
        mode: "human",
        stages: ["page-anchor-headings", "layout-block-order", "utf8-markdown"]
      },
      {
        target: "portable-docx",
        targetFormat: "docx",
        adapter: "pdf-pages-to-docx-review.v1",
        mode: "human",
        stages: ["page-section-breaks", "layout-notes", "openxml-package"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "pdf-layout-to-agent-elements.v1",
        mode: "agent",
        stages: ["page-bbox-element-refs", "link-refs", "outline-refs", "form-field-refs", "window-ids", "content-hashes"]
      },
      {
        target: "evidence-pack-json",
        targetFormat: "graph-evidence",
        adapter: "pdf-windows-to-graph-evidence.v1",
        mode: "agent",
        stages: ["text-units", "entities", "claims"]
      }
    ],
    qualityGates: ["page-order-preserved", "bbox-metadata-present-when-available", "pdf-link-refs-preserved", "pdf-outline-refs-preserved", "pdf-form-fields-preserved", "empty-corpus-blocked"],
    riskControls: ["font-mapping-risk", "image-only-pdf-ocr-fallback", "layout-geometry-approximation"],
    knownLosses: ["approximate-text-bbox", "complex-vector-layout-not-fully-reconstructed"]
  },
  word: {
    label: "Word",
    professionalFamily: "office-word",
    parserProfile: "wordprocessingml-paragraph-style-route",
    structureUnits: ["heading", "paragraph", "list-item", "paragraph-style", "numbering-ref", "table-row", "header", "footer", "content-control", "bookmark", "link", "image", "chart", "comment", "footnote", "endnote", "revision"],
    parserStages: ["office.word.structured", "office.word.styles", "office.word.numbering", "office.word.tables", "office.word.headers-footers", "office.word.content-controls", "office.word.bookmarks", "office.word.annotations", "office.word.revisions", "office.word.hyperlinks", "office.word.images", "office.word.charts", "tika.text"],
    preserves: ["headings", "paragraphs", "paragraphStyles", "listLevels", "lists", "tables", "cellRefs", "headers", "footers", "contentControls", "bookmarks", "links", "images", "charts", "chartSeries", "comments", "footnotes", "endnotes", "revisions"],
    conversionTargets: ["markdown-outline", "valid-openxml-docx", "agent-json-with-word-style-list-table-link-and-annotation-refs", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "word-elements-to-markdown-outline.v1",
        mode: "human",
        stages: ["heading-outline", "table-markdown", "annotation-sections"]
      },
      {
        target: "portable-docx",
        targetFormat: "docx",
        adapter: "word-elements-to-valid-openxml.v1",
        mode: "human",
        stages: ["paragraph-styles", "table-grid", "openxml-package"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "word-elements-to-agent-refs.v1",
        mode: "agent",
        stages: ["element-refs", "paragraph-style-refs", "numbering-refs", "table-cell-refs", "header-footer-refs", "content-control-refs", "bookmark-refs", "link-refs", "image-refs", "chart-refs", "annotation-refs", "revision-refs"]
      },
      {
        target: "evidence-pack-json",
        targetFormat: "graph-evidence",
        adapter: "word-windows-to-graph-evidence.v1",
        mode: "agent",
        stages: ["text-units", "relationships", "claims"]
      }
    ],
    qualityGates: ["docx-openxml-package-valid", "word-paragraph-style-refs-preserved", "word-list-refs-preserved", "word-table-cell-refs-preserved", "word-header-footer-refs-preserved", "word-content-control-refs-preserved", "word-bookmark-refs-preserved", "word-link-refs-preserved", "word-image-refs-preserved", "word-chart-refs-preserved", "word-annotation-refs-preserved", "word-revision-refs-preserved"],
    riskControls: ["legacy-doc-tika-fallback", "advanced-style-loss-reporting", "tracked-changes-preserved-when-present"],
    knownLosses: ["advanced-openxml-styling-not-rendered"]
  },
  presentation: {
    label: "PowerPoint",
    professionalFamily: "office-presentation",
    parserProfile: "presentationml-slide-route",
    structureUnits: ["slide", "slide-layout", "slide-master", "heading", "placeholder", "slide-shape", "table-row", "link", "image", "chart", "speaker-note", "comment"],
    parserStages: ["office.presentation.slides", "office.presentation.layouts", "office.presentation.placeholders", "office.presentation.tables", "office.presentation.hyperlinks", "office.presentation.images", "office.presentation.charts", "office.presentation.speaker-notes", "office.presentation.comments", "tika.text", "ocr.slide-images"],
    preserves: ["slide-order", "slide-heading", "slide-layout", "slide-master", "body-paragraphs", "shape-id", "shape-name", "shape-placeholder", "shape-bbox", "shape-order", "tables", "cellRefs", "links", "images", "charts", "chartSeries", "speaker-notes", "comments"],
    conversionTargets: ["markdown-slide-outline", "docx-review-copy", "agent-json-with-slide-layout-placeholder-table-link-and-note-refs", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "slides-to-markdown-outline.v1",
        mode: "human",
        stages: ["slide-headings", "shape-order", "table-markdown"]
      },
      {
        target: "portable-docx",
        targetFormat: "docx",
        adapter: "slides-to-docx-review.v1",
        mode: "human",
        stages: ["slide-sections", "shape-bullets", "openxml-package"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "slides-to-agent-layout-refs.v1",
        mode: "agent",
        stages: ["slide-refs", "slide-layout-refs", "slide-master-refs", "shape-placeholder-refs", "shape-bbox-refs", "table-cell-refs", "link-refs", "image-refs", "chart-refs", "speaker-note-refs", "comment-refs"]
      },
      {
        target: "evidence-pack-json",
        targetFormat: "graph-evidence",
        adapter: "slides-to-graph-evidence.v1",
        mode: "agent",
        stages: ["text-units", "slide-relationships", "claims"]
      }
    ],
    qualityGates: ["slide-order-preserved", "presentation-layout-master-refs-preserved", "presentation-placeholder-refs-preserved", "shape-layout-refs-present", "presentation-table-cell-refs-preserved", "presentation-link-refs-preserved", "presentation-image-refs-preserved", "presentation-chart-refs-preserved", "presentation-speaker-notes-preserved", "presentation-comment-refs-preserved"],
    riskControls: ["speaker-notes-preserved-when-notesSlides-present", "comments-preserved-when-comment-parts-present", "raster-only-slide-ocr-fallback"],
    knownLosses: ["visual-layer-geometry-partial"]
  },
  visio: {
    label: "Visio",
    professionalFamily: "office-drawing",
    parserProfile: "visio-opc-page-shape-route",
    structureUnits: ["page", "visio-shape", "visio-connector", "shape-text", "shape-bbox"],
    parserStages: ["office.visio.pages", "office.visio.shapes", "office.visio.connectors", "office.visio.text", "tika.text"],
    preserves: ["page-order", "shape-id", "shape-name", "shape-text", "shape-bbox", "shape-order", "connectors"],
    conversionTargets: ["markdown-page-outline", "docx-review-copy", "agent-json-with-visio-shape-and-connector-refs", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "visio-pages-to-markdown-outline.v1",
        mode: "human",
        stages: ["page-headings", "shape-order", "connector-notes"]
      },
      {
        target: "portable-docx",
        targetFormat: "docx",
        adapter: "visio-pages-to-docx-review.v1",
        mode: "human",
        stages: ["page-sections", "shape-bullets", "connector-table", "openxml-package"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "visio-elements-to-agent-refs.v1",
        mode: "agent",
        stages: ["page-refs", "shape-id-name-refs", "shape-bbox-refs", "connector-refs", "window-ids"]
      },
      {
        target: "evidence-pack-json",
        targetFormat: "graph-evidence",
        adapter: "visio-windows-to-graph-evidence.v1",
        mode: "agent",
        stages: ["text-units", "shape-relationships", "claims"]
      }
    ],
    qualityGates: ["visio-page-order-preserved", "visio-shape-refs-preserved", "visio-shape-layout-refs-present", "visio-connector-refs-preserved", "empty-corpus-blocked"],
    riskControls: ["legacy-vsd-tika-fallback", "shape-geometry-approximation"],
    knownLosses: ["advanced-visio-style-and-master-rendering-not-reconstructed"]
  },
  spreadsheet: {
    label: "Excel",
    professionalFamily: "office-spreadsheet",
    parserProfile: "spreadsheetml-sheet-row-cell-route",
    structureUnits: ["workbook-sheet", "defined-name", "named-range", "print-area", "sheet", "table-header", "table-row", "merged-cell", "cell-comment", "cell", "formula", "hyperlink", "chart", "time-signal"],
    parserStages: ["table.sheet.structured", "table.workbook.sheets", "table.workbook.defined-names", "table.sheet.headers", "table.sheet.cells", "table.sheet.merged-cells", "table.sheet.comments", "table.sheet.date-styles", "table.sheet.formulas", "table.sheet.hyperlinks", "table.sheet.charts", "table.time-index"],
    preserves: ["sheet", "sheetName", "sheetId", "sheetState", "worksheetPath", "definedNames", "namedRanges", "printAreas", "row", "column", "cellRefs", "headers", "mergedCells", "cellComments", "dateStyles", "dateSerials", "formulas", "hyperlinks", "charts", "chartSeries", "timeSignals"],
    conversionTargets: ["markdown-tables", "docx-review-copy", "agent-json-with-workbook-sheet-cell-coordinates-and-formulas", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "sheets-to-markdown-tables.v1",
        mode: "human",
        stages: ["sheet-sections", "header-row-capture", "formula-notes", "hyperlink-notes"]
      },
      {
        target: "portable-docx",
        targetFormat: "docx",
        adapter: "sheets-to-docx-review-tables.v1",
        mode: "human",
        stages: ["sheet-heading", "table-grid", "openxml-package"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "sheets-to-agent-cell-refs.v1",
        mode: "agent",
        stages: ["workbook-sheet-refs", "defined-name-refs", "named-range-refs", "cell-coordinate-refs", "merged-cell-refs", "cell-comment-refs", "date-serial-refs", "formula-refs", "hyperlink-refs", "chart-refs", "time-signals"]
      },
      {
        target: "evidence-pack-json",
        targetFormat: "graph-evidence",
        adapter: "sheets-to-graph-evidence.v1",
        mode: "agent",
        stages: ["row-text-units", "entity-columns", "claim-values"]
      }
    ],
    qualityGates: ["spreadsheet-workbook-sheet-refs-preserved", "spreadsheet-defined-name-refs-preserved", "sheet-row-cell-refs-preserved", "spreadsheet-merged-cell-refs-preserved", "spreadsheet-comment-refs-preserved", "spreadsheet-date-serials-normalized", "formula-text-preserved", "spreadsheet-hyperlink-refs-preserved", "spreadsheet-chart-refs-preserved", "table-time-index-when-date-columns-exist"],
    riskControls: ["formula-results-not-recomputed"],
    knownLosses: ["formula-results-not-recomputed"]
  },
  markdown: {
    label: "Markdown",
    professionalFamily: "markdown",
    parserProfile: "markdown-block-element-route",
    structureUnits: ["frontmatter", "frontmatter-field", "heading", "paragraph", "list-item", "blockquote", "table-row", "code", "code-fence", "link", "image"],
    parserStages: ["text.markdown", "markdown.frontmatter", "markdown.structure"],
    preserves: ["heading-levels", "tables", "codeBlocks", "blockquotes", "links", "images", "frontmatter"],
    conversionTargets: ["clean-markdown", "valid-openxml-docx", "agent-json-with-block-refs", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "markdown-normalized-clean.v1",
        mode: "human",
        stages: ["frontmatter-section", "heading-tree", "table-and-code-blocks"]
      },
      {
        target: "portable-docx",
        targetFormat: "docx",
        adapter: "markdown-blocks-to-valid-openxml.v1",
        mode: "human",
        stages: ["heading-styles", "table-grid", "code-paragraphs", "openxml-package"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "markdown-blocks-to-agent-refs.v1",
        mode: "agent",
        stages: ["block-refs", "frontmatter-refs", "heading-paths", "code-block-refs", "blockquote-refs", "link-refs"]
      },
      {
        target: "evidence-pack-json",
        targetFormat: "graph-evidence",
        adapter: "markdown-windows-to-graph-evidence.v1",
        mode: "agent",
        stages: ["text-units", "entities", "claims"]
      }
    ],
    qualityGates: ["heading-tree-preserved", "markdown-frontmatter-refs-preserved", "markdown-table-blocks-preserved", "markdown-code-blocks-preserved", "markdown-blockquote-refs-preserved", "markdown-link-refs-preserved", "markdown-image-refs-preserved", "docx-openxml-package-valid"],
    riskControls: ["custom-extension-loss-reporting", "image-reference-preservation"],
    knownLosses: ["custom-markdown-extension-rendering-not-normalized"]
  },
  "open-document": {
    label: "OpenDocument",
    professionalFamily: "opendocument",
    parserProfile: "opendocument-content-xml-route",
    structureUnits: ["heading", "paragraph", "table-row", "cell", "link"],
    parserStages: ["open-document.structured", "open-document.tables", "open-document.hyperlinks", "tika.text"],
    preserves: ["headings", "paragraphs", "tables", "cellRefs", "links"],
    conversionTargets: ["markdown-outline", "docx-review-copy", "agent-json-with-opendocument-cell-and-link-refs", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "odf-elements-to-markdown-outline.v1",
        mode: "human",
        stages: ["heading-outline", "table-markdown", "content-xml-order"]
      },
      {
        target: "portable-docx",
        targetFormat: "docx",
        adapter: "odf-elements-to-docx-review.v1",
        mode: "human",
        stages: ["paragraph-styles", "table-grid", "openxml-package"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "odf-elements-to-agent-refs.v1",
        mode: "agent",
        stages: ["element-refs", "table-cell-refs", "link-refs"]
      },
      {
        target: "evidence-pack-json",
        targetFormat: "graph-evidence",
        adapter: "odf-windows-to-graph-evidence.v1",
        mode: "agent",
        stages: ["text-units", "entities", "claims"]
      }
    ],
    qualityGates: ["odf-content-order-preserved", "opendocument-table-cell-refs-preserved", "opendocument-link-refs-preserved", "empty-corpus-blocked"],
    riskControls: ["advanced-odf-style-loss-reporting"],
    knownLosses: ["advanced-odf-styling-not-rendered"]
  }
});

const MEDIA_TYPE_BY_EXTENSION = new Map(Object.entries({
  ".html": "text/html",
  ".htm": "text/html",
  ".xhtml": "application/xhtml+xml",
  ".xml": "application/xml",
  ".rst": "text/x-rst",
  ".adoc": "text/x-asciidoc",
  ".asciidoc": "text/x-asciidoc",
  ".org": "text/org",
  ".tex": "text/x-tex",
  ".latex": "application/x-latex",
  ".wiki": "text/x-mediawiki",
  ".mediawiki": "text/x-mediawiki",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".jsonc": "application/jsonc",
  ".jsonl": "application/x-ndjson",
  ".ndjson": "application/x-ndjson",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".log": "text/plain",
  ".doc": "application/msword",
  ".dot": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docm": "application/vnd.ms-word.document.macroenabled.12",
  ".dotx": "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  ".dotm": "application/vnd.ms-word.template.macroenabled.12",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pps": "application/vnd.ms-powerpoint",
  ".pot": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pptm": "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  ".ppsx": "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ".ppsm": "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
  ".potx": "application/vnd.openxmlformats-officedocument.presentationml.template",
  ".potm": "application/vnd.ms-powerpoint.template.macroenabled.12",
  ".vsd": "application/vnd.visio",
  ".vss": "application/vnd.visio",
  ".vst": "application/vnd.visio",
  ".vdx": "application/vnd.visio",
  ".vsdx": "application/vnd.ms-visio.drawing.main+xml",
  ".vsdm": "application/vnd.ms-visio.drawing.macroenabled.main+xml",
  ".vssx": "application/vnd.ms-visio.stencil.main+xml",
  ".vssm": "application/vnd.ms-visio.stencil.macroenabled.main+xml",
  ".vstx": "application/vnd.ms-visio.template.main+xml",
  ".vstm": "application/vnd.ms-visio.template.macroenabled.main+xml",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroenabled.12",
  ".xlsb": "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  ".xltx": "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  ".xltm": "application/vnd.ms-excel.template.macroenabled.12",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".epub": "application/epub+zip",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
  ".mbox": "application/mbox",
  ".ics": "text/calendar",
  ".vcs": "text/x-vcalendar",
  ".vtt": "text/vtt",
  ".webvtt": "text/vtt",
  ".srt": "application/x-subrip",
  ".sbv": "text/x-subtitle",
  ".xbrl": "application/xbrl+xml",
  ".ixbrl": "application/ixbrl+xml",
  ".directory": "inode/directory",
  ".folder": "inode/directory",
  ".pages": "application/vnd.apple.pages",
  ".numbers": "application/vnd.apple.numbers",
  ".key": "application/vnd.apple.keynote",
  ".keynote": "application/vnd.apple.keynote",
  ".xcodeproj": "application/x-xcode-project",
  ".xcworkspace": "application/x-xcode-workspace",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus"
}));

const GENERIC_MEDIA_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-binary",
  "application/unknown",
  "unknown/unknown"
]);

function nowIso() {
  return new Date().toISOString();
}

function sha(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function shaBuffer(buffer = Buffer.alloc(0)) {
  return crypto.createHash("sha256").update(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])).digest("hex");
}

function stableId(prefix, ...parts) {
  return `${prefix}_${sha(parts.join("\n")).slice(0, 18)}`;
}

function jsonResponse(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function textResponse(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(body);
}

function binaryResponse(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
    ...headers
  });
  response.end(Buffer.isBuffer(body) ? body : Buffer.from(body || []));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

async function loadRuns() {
  try {
    const parsed = JSON.parse(await fs.readFile(RUNS_PATH, "utf8"));
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return [];
  }
}

async function saveRuns(runs) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RUNS_PATH, `${JSON.stringify({ protocolVersion: PROTOCOL_VERSION, runs }, null, 2)}\n`);
}

function resolveReferenceFrameworkPath(localPath = "") {
  const value = String(localPath || "").trim();
  if (!value) {
    return "";
  }
  if (path.isAbsolute(value)) {
    return path.resolve(value);
  }
  const candidates = [
    path.resolve(process.cwd(), value),
    path.resolve(REPO_ROOT, value),
    path.resolve(SERVICE_ROOT, value)
  ];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || candidates[0];
}

function readGitCheckoutStatus(resolvedPath = "", manifestCommit = "") {
  if (!resolvedPath || !fsSync.existsSync(resolvedPath)) {
    return {
      exists: false,
      gitPresent: false,
      actualCommit: "",
      commitMatches: false,
      dirtyFileCount: 0,
      status: "missing"
    };
  }
  const gitDir = path.join(resolvedPath, ".git");
  if (!fsSync.existsSync(gitDir)) {
    return {
      exists: true,
      gitPresent: false,
      actualCommit: "",
      commitMatches: false,
      dirtyFileCount: 0,
      status: "not-git-checkout"
    };
  }
  try {
    const actualCommit = execFileSync("git", ["-C", resolvedPath, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      timeout: RUNTIME_DOCTOR_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    }).trim();
    const dirtyStatus = execFileSync("git", ["-C", resolvedPath, "status", "--short", "--untracked-files=no"], {
      encoding: "utf8",
      timeout: RUNTIME_DOCTOR_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    }).trim();
    const dirtyFileCount = dirtyStatus ? dirtyStatus.split(/\r?\n/).filter(Boolean).length : 0;
    const expected = String(manifestCommit || "").trim();
    const commitMatches = Boolean(expected) && actualCommit.startsWith(expected);
    return {
      exists: true,
      gitPresent: true,
      actualCommit,
      commitMatches,
      dirtyFileCount,
      status: commitMatches ? (dirtyFileCount ? "verified-dirty" : "verified") : "commit-mismatch"
    };
  } catch (error) {
    return {
      exists: true,
      gitPresent: true,
      actualCommit: "",
      commitMatches: false,
      dirtyFileCount: 0,
      status: "git-audit-failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildReferenceFrameworkAudit({ localRoot = "", frameworks = [] } = {}) {
  const resolvedLocalRoot = resolveReferenceFrameworkPath(localRoot);
  const audited = frameworks.map((framework) => {
    const resolvedPath = resolveReferenceFrameworkPath(framework.localPath || "");
    const git = readGitCheckoutStatus(resolvedPath, framework.commit || "");
    return {
      id: framework.id,
      repo: framework.repo,
      localPath: framework.localPath,
      resolvedPath,
      manifestCommit: framework.commit || "",
      exists: git.exists,
      gitPresent: git.gitPresent,
      actualCommit: git.actualCommit,
      commitMatches: git.commitMatches,
      dirtyFileCount: git.dirtyFileCount,
      status: git.status,
      error: git.error || "",
      syncCommand: `npm run server:external-kd:sync-references -- --only ${framework.id}`
    };
  });
  return {
    strategy: REFERENCE_FRAMEWORK_AUDIT_STRATEGY,
    generatedAt: nowIso(),
    localRoot,
    resolvedLocalRoot,
    auditCommand: "npm run server:external-kd:references",
    syncCommand: "npm run server:external-kd:sync-references",
    expectedCount: frameworks.length,
    presentCount: audited.filter((framework) => framework.exists).length,
    gitCheckoutCount: audited.filter((framework) => framework.gitPresent).length,
    commitMatchCount: audited.filter((framework) => framework.commitMatches).length,
    dirtyCheckoutCount: audited.filter((framework) => framework.dirtyFileCount > 0).length,
    missingCount: audited.filter((framework) => !framework.exists).length,
    frameworks: audited
  };
}

async function loadReferenceFrameworks() {
  const parsed = JSON.parse(await fs.readFile(REFERENCE_FRAMEWORKS_PATH, "utf8"));
  const frameworks = Array.isArray(parsed.frameworks) ? parsed.frameworks : [];
  const localRoot = parsed.localRoot || "";
  return {
    protocolVersion: parsed.protocolVersion || "pact.external-knowledge-distillation.references.v1",
    generatedAt: parsed.generatedAt || "",
    localRoot,
    selectionPolicy: parsed.selectionPolicy || {},
    frameworks,
    localAudit: buildReferenceFrameworkAudit({ localRoot, frameworks })
  };
}

const REFERENCE_ABSORPTION_MAP = Object.freeze({
  ragflow: {
    absorbed: ["route-first document understanding", "agent-readable knowledge-base flow", "large project artifact package", "mounted project directory expansion"],
    baseline: ["RAG-style source routing and evidence attachment"],
    gaps: ["ranking/evaluation loop over external vector stores", "full document-layout enrichment for every parser"]
  },
  mineru: {
    absorbed: ["PDF, Office, OpenDocument, EPUB, image, email, and archive routing", "PDF URI annotation and outline refs", "LLM-ready Markdown/JSON outputs", "SpreadsheetML workbook sheet, defined-name, comment, and formula metadata"],
    baseline: ["file-ref parsers for large binary payloads"],
    gaps: ["high-fidelity layout reconstruction for complex PDFs"]
  },
  docling: {
    absorbed: ["unified routePlan/corpusPlan/parserTrace document model", "table time index for structured sheets", "HTML, XML, AsciiDoc, LaTeX, Markdown, OOXML, OpenDocument, EPUB, and PDF element models", "basic PDF text-operator geometry for page/x/y/bbox metadata", "PDF outline/bookmark references", "WordprocessingML content controls and bookmark anchors", "WordprocessingML, PresentationML, and OpenDocument table row/cell metadata", "WordprocessingML, PresentationML, and OpenDocument hyperlink targets", "WordprocessingML comments, revisions, footnotes, and endnotes", "spreadsheet workbook sheet id/name/path plus defined-name/named-range/print-area and row/cell coordinate/comment/formula/hyperlink metadata", "PresentationML shape id/name, placeholder, comment, and geometry metadata for slide elements", "Visio OPC page, shape, connector, and shape-geometry metadata extraction"],
    baseline: ["structured ZIP extraction for OOXML and OpenDocument"],
    gaps: ["full PDF and Word layout block geometry", "formula recognition beyond SpreadsheetML and text-level elements"]
  },
  "llama-index": {
    absorbed: ["agent-message-json", "graphEvidence text units with metadata", "evidence query API", "node-style element references on windows and text units", "directory child documents as routed nodes"],
    baseline: ["node/window metadata and project snapshot hashes"],
    gaps: ["pluggable ingestion pipeline contracts", "agent evaluation feedback loop"]
  },
  marker: {
    absorbed: ["portable Markdown output", "Markdown block parsing", "JSON evidence pack", "DOCX and workspace ZIP packaging"],
    baseline: ["PDF text extraction and OCR fallback"],
    gaps: ["layout-aware PDF to Markdown ordering", "equation/table image reconstruction"]
  },
  graphrag: {
    absorbed: ["text_units/entities/relationships/covariates/communities/community_reports", "community reports for large project convergence", "domain/topic global-local project read model", "incremental project snapshot"],
    baseline: ["local graph-lite evidence pack"],
    gaps: ["persistent graph store adapter", "learned graph ranking over multi-run evidence"]
  },
  haystack: {
    absorbed: ["explicit route stages", "parser traces", "runtime doctor", "capabilities document", "directory file-ref expansion stage", "HTML/Markdown-style converter boundaries for markup and Markdown documents", "Word, PowerPoint, Excel, and Visio parser stages with element refs", "Word, PowerPoint, and Excel hyperlink preservation on element/cell refs", "format conversion profiles for human and agent targets"],
    baseline: ["pipeline-like deterministic execution record"],
    gaps: ["external component registry", "configurable parser/ranker pipeline graph"]
  },
  unstructured: {
    absorbed: ["partition-style format routing", "chunked windowing", "email, archive, and directory child routing", "element-type enrichment for Markdown, markup, PDF, OOXML, OpenDocument, EPUB, headings, lists, links, tables, PDF outlines, Word content controls/bookmarks, Word/PowerPoint/OpenDocument table cells, Word annotations/revisions and hyperlinks, PowerPoint comments and hyperlinks, OpenDocument hyperlinks, code, formulas, spreadsheet workbook sheet refs/defined names/comments/hyperlinks, slide shapes, PowerPoint placeholders, Visio shapes, and Visio connectors", "by-title element-aware windowing with table/code isolation"],
    baseline: ["strategy-based parser fallback"],
    gaps: ["remaining high-fidelity PDF, Word, and spreadsheet layout coordinates", "domain-specific chunk enrichment plugins"]
  }
});

function buildReferenceGapReport(referenceFrameworks = null, { run = null, runtimeStatus = null } = {}) {
  const frameworks = Array.isArray(referenceFrameworks?.frameworks) ? referenceFrameworks.frameworks : [];
  const auditById = new Map((referenceFrameworks?.localAudit?.frameworks || []).map((framework) => [framework.id, framework]));
  const frameworkReports = frameworks.map((framework) => {
    const mapped = REFERENCE_ABSORPTION_MAP[framework.id] || {
      absorbed: [],
      baseline: [],
      gaps: ["manual review required for this framework"]
    };
    const audit = auditById.get(framework.id) || null;
    return {
      id: framework.id,
      name: framework.name,
      repo: framework.repo,
      localPath: framework.localPath,
      commit: framework.commit,
      license: framework.license,
      starsAtSelection: framework.starsAtSelection,
      learnFrom: framework.learnFrom || [],
      localAudit: audit
        ? {
            status: audit.status,
            exists: audit.exists,
            gitPresent: audit.gitPresent,
            actualCommit: audit.actualCommit,
            commitMatches: audit.commitMatches,
            dirtyFileCount: audit.dirtyFileCount
          }
        : null,
      absorbedPatterns: mapped.absorbed,
      baselinePatterns: mapped.baseline,
      openGaps: mapped.gaps,
      status: audit && !audit.commitMatches
        ? "reference-checkout-needs-refresh"
        : mapped.gaps.length
          ? "absorbed-with-open-gaps"
          : "absorbed"
    };
  });
  const openGaps = uniqueOrdered(frameworkReports.flatMap((framework) => framework.openGaps));
  return {
    protocolVersion: `${PROTOCOL_VERSION}.reference-gap-report`,
    strategy: REFERENCE_GAP_REPORT_STRATEGY,
    generatedAt: nowIso(),
    runId: run?.runId || "",
    referenceFrameworks: {
      protocolVersion: referenceFrameworks?.protocolVersion || "",
      localRoot: referenceFrameworks?.localRoot || "",
      count: frameworks.length,
      localAudit: referenceFrameworks?.localAudit
        ? {
            strategy: referenceFrameworks.localAudit.strategy,
            generatedAt: referenceFrameworks.localAudit.generatedAt,
            auditCommand: referenceFrameworks.localAudit.auditCommand,
            syncCommand: referenceFrameworks.localAudit.syncCommand,
            expectedCount: referenceFrameworks.localAudit.expectedCount,
            presentCount: referenceFrameworks.localAudit.presentCount,
            gitCheckoutCount: referenceFrameworks.localAudit.gitCheckoutCount,
            commitMatchCount: referenceFrameworks.localAudit.commitMatchCount,
            dirtyCheckoutCount: referenceFrameworks.localAudit.dirtyCheckoutCount,
            missingCount: referenceFrameworks.localAudit.missingCount
          }
        : null
    },
    absorbedCapabilityMap: {
      fileCompatibility: {
        status: "baseline-absorbed",
        evidence: ["routePlan", "parserTrace", "fileCompatibility.formats", "runtimeDoctor"],
        references: ["docling", "mineru", "marker", "unstructured", "haystack"]
      },
      allSizeProcessing: {
        status: "baseline-absorbed",
        evidence: ["filePath/contentRef", "input.manifest.jsonl", "payload.stream-text", "archive.entry-file-ref", "directory.entry-file-ref", "streaming-windowed"],
        references: ["ragflow", "haystack", "unstructured"]
      },
      classificationDistillation: {
        status: "absorbed",
        evidence: [CLASSIFICATION_STRATEGY, "semantic-concept-topic-hierarchy.v1", "leader-clustering-semantic-concept-rationale.v1", "lowCouplingHighCohesion", "garbage group", "distillationUnit"],
        references: ["graphrag", "llama-index", "haystack"]
      },
      projectConvergence: {
        status: "absorbed",
        evidence: [PROJECT_CONVERGENCE_STRATEGY, "agent-project-convergence-query-index.v1", "project-domain layer", INCREMENTAL_CONVERGENCE_STRATEGY],
        references: ["graphrag", "ragflow"]
      },
      graphEvidence: {
        status: "absorbed",
        evidence: [GRAPH_EVIDENCE_STRATEGY, EVIDENCE_QUERY_STRATEGY],
        references: ["graphrag", "llama-index", "haystack"]
      },
      exportModes: {
        status: "absorbed",
        evidence: ["portable-markdown", "portable-docx", "agent-message-json", "workspace-package-zip"],
        references: ["marker", "llama-index", "ragflow"]
      }
    },
    runtimeEvidence: runtimeStatus?.summary || null,
    runEvidence: run
      ? {
          status: run.status,
          algorithmVersion: run.result?.algorithmVersion || "",
          sourceCount: run.inputSummary?.sourceCount || 0,
          distillableSourceCount: run.inputSummary?.distillableSourceCount || 0,
          windowCount: run.inputSummary?.windowCount || 0,
          groupCount: run.result?.classification?.groupCount || 0,
          graphEvidence: run.result?.graphEvidence?.summary || null,
          artifacts: (run.artifactRefs || []).map((artifact) => artifact.artifactId)
        }
      : null,
    frameworks: frameworkReports,
    openGaps,
    nextActions: openGaps.slice(0, 8).map((gap) => ({
      gap,
      action: "convert this gap into a parser, pipeline, graph, or evaluation verifier before marking it absorbed"
    }))
  };
}

async function probeCommand(command, args = []) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: RUNTIME_DOCTOR_TIMEOUT_MS,
      windowsHide: true
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    return {
      available: true,
      command,
      version: output.split(/\r?\n/).find(Boolean) || ""
    };
  } catch (error) {
    return {
      available: false,
      command,
      error: error?.code === "ENOENT"
        ? "not-found"
        : error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

async function probePythonModule(moduleName) {
  const python = process.env.PACT_EXTERNAL_KD_PYTHON || process.env.PYTHON || "python3";
  try {
    const result = await execFileAsync(python, ["-c", `import ${moduleName}; print(getattr(${moduleName}, "__version__", "available"))`], {
      timeout: RUNTIME_DOCTOR_TIMEOUT_MS,
      windowsHide: true
    });
    return {
      available: true,
      command: python,
      module: moduleName,
      version: String(result.stdout || "").trim()
    };
  } catch (error) {
    return {
      available: false,
      command: python,
      module: moduleName,
      error: error?.code === "ENOENT"
        ? "python-not-found"
        : error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

async function probeTikaApp(javaCommand = "java") {
  const jarPath = path.resolve(TIKA_APP_JAR);
  if (!fsSync.existsSync(jarPath)) {
    return {
      available: false,
      command: javaCommand,
      jarPath,
      error: "tika-app-jar-not-found"
    };
  }
  try {
    const result = await execFileAsync(javaCommand, ["-jar", jarPath, "--version"], {
      timeout: RUNTIME_DOCTOR_TIMEOUT_MS,
      windowsHide: true
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    return {
      available: true,
      command: javaCommand,
      jarPath,
      version: output.split(/\r?\n/).find(Boolean) || "available"
    };
  } catch (versionError) {
    try {
      await execFileAsync(javaCommand, ["-jar", jarPath, "--help"], {
        timeout: RUNTIME_DOCTOR_TIMEOUT_MS,
        windowsHide: true
      });
      return {
        available: true,
        command: javaCommand,
        jarPath,
        version: "available"
      };
    } catch (helpError) {
      return {
        available: false,
        command: javaCommand,
        jarPath,
        error: helpError instanceof Error ? helpError.message : String(helpError || versionError)
      };
    }
  }
}

async function probeFirstCommand(candidates = [], args = []) {
  let last = null;
  for (const command of candidates) {
    const probe = await probeCommand(command, args);
    if (probe.available) {
      return probe;
    }
    last = probe;
  }
  return last || {
    available: false,
    command: candidates[0] || "",
    error: "not-found"
  };
}

async function runtimeDoctor({ force = false } = {}) {
  if (!force && runtimeDoctorCache && Date.now() - runtimeDoctorCache.cachedAt < RUNTIME_DOCTOR_CACHE_MS) {
    return runtimeDoctorCache.payload;
  }
  const [
    java,
    tesseract,
    pdftoppm,
    pdftotext,
    pythonFitz,
    pythonPaddle,
    tarRuntime,
    gzipRuntime,
    sevenZipRuntime,
    unzipRuntime
  ] = await Promise.all([
    probeCommand(process.env.JAVA || "java", ["-version"]),
    probeCommand(process.env.TESSERACT || "tesseract", ["--version"]),
    probeCommand(process.env.PDFTOPPM || "pdftoppm", ["-v"]),
    probeCommand(process.env.PDFTOTEXT || "pdftotext", ["-v"]),
    probePythonModule("fitz"),
    probePythonModule("paddleocr"),
    probeCommand(process.env.TAR || "tar", ["--version"]),
    probeCommand(process.env.GZIP || "gzip", ["--version"]),
    probeFirstCommand([process.env.SEVEN_ZIP, "7zz", "7z", "7za"].filter(Boolean), ["--help"]),
    probeCommand(process.env.UNZIP || "unzip", ["-v"])
  ]);
  const tikaApp = java.available ? await probeTikaApp(java.command || process.env.JAVA || "java") : {
    available: false,
    command: process.env.JAVA || "java",
    jarPath: path.resolve(TIKA_APP_JAR),
    error: java.error || "java-runtime-unavailable"
  };
  const runtimes = {
    "tika.java": {
      capability: "tika.text",
      requiredFor: ["legacy-office", "fallback-text"],
      ...java
    },
    "tika.app": {
      capability: "tika.text",
      requiredFor: ["legacy-office", "rtf", "fallback-text"],
      ...tikaApp
    },
    "ocr.tesseract": {
      capability: "ocr.image",
      requiredFor: ["images", "scanned-pdf"],
      ...tesseract
    },
    "pdf.poppler": {
      capability: "pdf.page-render",
      requiredFor: ["scanned-pdf", "pdf-page-rasterization"],
      ...pdftoppm
    },
    "pdf.pdftotext": {
      capability: "pdf.text",
      requiredFor: ["large-pdf-file-ref", "pdf-text-file-ref"],
      ...pdftotext
    },
    "pdf.pymupdf": {
      capability: "pdf.visual.layout",
      requiredFor: ["layout-pdf", "font-mapping-broken-pdf"],
      ...pythonFitz
    },
    "ocr.paddleocr": {
      capability: "ocr.page",
      requiredFor: ["multilingual-ocr", "scanned-pdf"],
      ...pythonPaddle
    },
    "archive.tar": {
      capability: "archive.tar",
      requiredFor: ["tar-manifest", "tar-child-route"],
      builtInParserAvailable: true,
      ...tarRuntime
    },
    "archive.gzip": {
      capability: "archive.gzip",
      requiredFor: ["gzip", "tgz"],
      builtInParserAvailable: true,
      ...gzipRuntime
    },
    "archive.7zip": {
      capability: "archive.7z",
      requiredFor: ["7z-child-route"],
      ...sevenZipRuntime
    },
    "archive.unzip": {
      capability: "archive.zip",
      requiredFor: ["zip-file-ref-child-route"],
      ...unzipRuntime
    }
  };
  const summary = {
    builtInParserCount: 15,
    optionalRuntimeCount: Object.keys(runtimes).length,
    availableOptionalRuntimeCount: Object.values(runtimes).filter((runtime) => runtime.available).length,
    ocrAvailable: Boolean(runtimes["ocr.tesseract"].available || runtimes["ocr.paddleocr"].available),
    pdfVisualAvailable: Boolean(runtimes["pdf.pymupdf"].available),
    pdfRasterizerAvailable: Boolean(runtimes["pdf.poppler"].available),
    pdfTextExtractorAvailable: Boolean(runtimes["pdf.pdftotext"].available),
    archiveExternalAvailable: Boolean(runtimes["archive.7zip"].available)
  };
  const payload = {
    protocolVersion: `${PROTOCOL_VERSION}.runtime-doctor`,
    generatedAt: nowIso(),
    status: summary.ocrAvailable && summary.pdfVisualAvailable ? "ready" : "degraded",
    summary,
    runtimes
  };
  runtimeDoctorCache = {
    cachedAt: Date.now(),
    payload
  };
  return payload;
}

function compactRun(run = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    serviceName: SERVICE_NAME,
    serviceKind: SERVICE_KIND,
    runId: run.runId,
    status: run.status,
    title: run.title,
    query: run.query,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    projectId: run.result?.incrementalPlan?.projectId || run.inputSummary?.projectId || "",
    projectFingerprint: run.result?.incrementalPlan?.projectFingerprint || "",
    sourceCount: run.inputSummary?.sourceCount || 0,
    artifactRefs: run.artifactRefs || []
  };
}

function normalizeExtension(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  return text.startsWith(".") ? text : `.${text}`;
}

function extensionFromFileName(fileName = "") {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".tar.gz")) {
    return ".tar.gz";
  }
  const baseName = path.basename(normalized);
  if (baseName === ".env" || baseName.startsWith(".env.")) {
    return ".env";
  }
  return normalizeExtension(path.extname(normalized));
}

function inferMediaTypeFromExtension(extension = "") {
  const normalizedExtension = normalizeExtension(extension);
  if (MEDIA_TYPE_BY_EXTENSION.has(normalizedExtension)) {
    return MEDIA_TYPE_BY_EXTENSION.get(normalizedExtension);
  }
  const route = ROUTES_BY_EXTENSION.get(normalizedExtension);
  return route?.mediaTypes?.[0] || "";
}

function routeForExtension(extension = "") {
  return ROUTES_BY_EXTENSION.get(normalizeExtension(extension)) || null;
}

function mediaTypeForExtension(extension = "") {
  return inferMediaTypeFromExtension(extension) || routeForExtension(extension)?.mediaTypes?.[0] || "application/octet-stream";
}

function normalizeByteSize(value, fallbackText = "") {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) {
    return Math.floor(number);
  }
  return Buffer.byteLength(String(fallbackText || ""), "utf8");
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentPathFromDocument(document = {}, metadata = {}) {
  return String(
    document.filePath ||
      document.contentPath ||
      document.inputPath ||
      document.contentRef ||
      metadata.filePath ||
      metadata.contentPath ||
      metadata.inputPath ||
      metadata.contentRef ||
      ""
  ).trim();
}

function readFileHeadSample(filePath = "", maxBytes = SIGNATURE_SNIFF_BYTES) {
  const stat = fsSync.statSync(filePath);
  const bytesToRead = Math.min(Math.max(0, Number(maxBytes || 0)), stat.size);
  if (!bytesToRead) {
    return Buffer.alloc(0);
  }
  const buffer = Buffer.alloc(bytesToRead);
  let file = null;
  try {
    file = fsSync.openSync(filePath, "r");
    const bytesRead = fsSync.readSync(file, buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    if (file !== null) {
      fsSync.closeSync(file);
    }
  }
}

function zipSignatureHint(buffer = Buffer.alloc(0)) {
  const entries = readZipEntries(buffer);
  const names = entries.map((entry) => String(entry.name || ""));
  const lowerNames = names.map((name) => name.toLowerCase());
  const mimetype = entries.find((entry) => entry.name === "mimetype")?.data?.toString("utf8").trim() || "";
  if (lowerNames.some((name) => name === "word/document.xml" || name.startsWith("word/"))) {
    return {
      extension: ".docx",
      mediaType: mediaTypeForExtension(".docx"),
      signature: "zip-ooxml-word",
      container: "zip",
      evidence: names.slice(0, 12),
      confidence: 0.99
    };
  }
  if (lowerNames.some((name) => name.startsWith("ppt/"))) {
    return {
      extension: ".pptx",
      mediaType: mediaTypeForExtension(".pptx"),
      signature: "zip-ooxml-presentation",
      container: "zip",
      evidence: names.slice(0, 12),
      confidence: 0.99
    };
  }
  if (lowerNames.some((name) => name.startsWith("visio/"))) {
    return {
      extension: ".vsdx",
      mediaType: mediaTypeForExtension(".vsdx"),
      signature: "zip-ooxml-visio",
      container: "zip",
      evidence: names.slice(0, 12),
      confidence: 0.99
    };
  }
  if (lowerNames.some((name) => name.startsWith("xl/"))) {
    return {
      extension: ".xlsx",
      mediaType: mediaTypeForExtension(".xlsx"),
      signature: "zip-ooxml-spreadsheet",
      container: "zip",
      evidence: names.slice(0, 12),
      confidence: 0.99
    };
  }
  if (/application\/vnd\.oasis\.opendocument\.spreadsheet/.test(mimetype)) {
    return {
      extension: ".ods",
      mediaType: mediaTypeForExtension(".ods"),
      signature: "zip-opendocument-spreadsheet",
      container: "zip",
      evidence: [mimetype, ...names].filter(Boolean).slice(0, 12),
      confidence: 0.99
    };
  }
  if (/application\/vnd\.oasis\.opendocument\.presentation/.test(mimetype)) {
    return {
      extension: ".odp",
      mediaType: mediaTypeForExtension(".odp"),
      signature: "zip-opendocument-presentation",
      container: "zip",
      evidence: [mimetype, ...names].filter(Boolean).slice(0, 12),
      confidence: 0.99
    };
  }
  if (/application\/vnd\.oasis\.opendocument\.text/.test(mimetype) || lowerNames.includes("content.xml")) {
    return {
      extension: ".odt",
      mediaType: mediaTypeForExtension(".odt"),
      signature: "zip-opendocument",
      container: "zip",
      evidence: [mimetype, ...names].filter(Boolean).slice(0, 12),
      confidence: mimetype ? 0.99 : 0.82
    };
  }
  if (/application\/epub\+zip/.test(mimetype) || lowerNames.includes("meta-inf/container.xml") || lowerNames.some((name) => name.endsWith(".xhtml"))) {
    return {
      extension: ".epub",
      mediaType: mediaTypeForExtension(".epub"),
      signature: "zip-epub",
      container: "zip",
      evidence: [mimetype, ...names].filter(Boolean).slice(0, 12),
      confidence: 0.96
    };
  }
  return {
    extension: ".zip",
    mediaType: "application/zip",
    signature: "zip-container",
    container: "zip",
    evidence: names.slice(0, 12),
    confidence: 0.9
  };
}

function contentSignatureHint(buffer = Buffer.alloc(0)) {
  const data = Buffer.from(buffer || []);
  if (!data.length) {
    return null;
  }
  const ascii = data.subarray(0, Math.min(data.length, 512)).toString("latin1");
  const trimmed = ascii.replace(/^\uFEFF/, "").trimStart();
  const starts = (value) => data.length >= value.length && data.subarray(0, value.length).equals(Buffer.from(value, "binary"));
  if (starts("%PDF-")) {
    return { extension: ".pdf", mediaType: "application/pdf", signature: "pdf-header", container: "pdf", evidence: ["%PDF-"], confidence: 0.99 };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mediaType: "image/png", signature: "png-header", container: "image", evidence: ["89504e470d0a1a0a"], confidence: 0.99 };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { extension: ".jpg", mediaType: "image/jpeg", signature: "jpeg-header", container: "image", evidence: ["ffd8ff"], confidence: 0.99 };
  }
  if (/^GIF8[79]a/.test(ascii)) {
    return { extension: ".gif", mediaType: "image/gif", signature: "gif-header", container: "image", evidence: [ascii.slice(0, 6)], confidence: 0.98 };
  }
  if (starts("II*\x00") || starts("MM\x00*")) {
    return { extension: ".tif", mediaType: "image/tiff", signature: "tiff-header", container: "image", evidence: [data.subarray(0, 4).toString("hex")], confidence: 0.98 };
  }
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: ".webp", mediaType: "image/webp", signature: "webp-riff-header", container: "image", evidence: ["RIFF", "WEBP"], confidence: 0.98 };
  }
  if (starts("BM")) {
    return { extension: ".bmp", mediaType: "image/bmp", signature: "bmp-header", container: "image", evidence: ["BM"], confidence: 0.96 };
  }
  if (data.length >= 6 && data.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) {
    return { extension: ".7z", mediaType: "application/x-7z-compressed", signature: "7z-header", container: "archive", evidence: ["377abcaf271c"], confidence: 0.99 };
  }
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return { extension: ".gz", mediaType: "application/gzip", signature: "gzip-header", container: "archive", evidence: ["1f8b"], confidence: 0.98 };
  }
  if (data.length >= 265 && data.subarray(257, 263).toString("ascii") === "ustar") {
    return { extension: ".tar", mediaType: "application/x-tar", signature: "tar-ustar", container: "archive", evidence: ["ustar"], confidence: 0.98 };
  }
  if (data.length >= 4 && data.subarray(0, 2).toString("ascii") === "PK") {
    return zipSignatureHint(data);
  }
  if (/^\{\\rtf/i.test(trimmed)) {
    return { extension: ".rtf", mediaType: "application/rtf", signature: "rtf-header", container: "document", evidence: ["{\\rtf"], confidence: 0.94 };
  }
  if (/^(?:<!doctype\s+html|<html[\s>])/i.test(trimmed)) {
    return { extension: ".html", mediaType: "text/html", signature: "html-leading-tag", container: "markup", evidence: [trimmed.slice(0, 40)], confidence: 0.88 };
  }
  return null;
}

function shouldApplySignatureHint(metadata = {}, hint = null) {
  if (!hint?.extension || !hint?.mediaType) {
    return false;
  }
  const currentRoute = lookupFormatRoute(metadata);
  const hintedRoute = routeForExtension(hint.extension);
  if (!hintedRoute) {
    return false;
  }
  const currentMediaType = String(metadata.mediaType || "").toLowerCase();
  const currentExtension = normalizeExtension(metadata.extension || "");
  if (!currentRoute || GENERIC_MEDIA_TYPES.has(currentMediaType) || !ROUTES_BY_EXTENSION.has(currentExtension)) {
    return true;
  }
  return currentRoute.id !== hintedRoute.id && Number(hint.confidence || 0) >= 0.95;
}

function applySignatureHintToMetadata(metadata = {}, hint = null) {
  if (!shouldApplySignatureHint(metadata, hint)) {
    return metadata;
  }
  return {
    ...metadata,
    declaredExtension: metadata.declaredExtension || metadata.extension || "",
    declaredMediaType: metadata.declaredMediaType || metadata.mediaType || "",
    extension: hint.extension,
    mediaType: hint.mediaType,
    sniffedExtension: hint.extension,
    sniffedMediaType: hint.mediaType,
    contentSignature: hint.signature || "",
    contentSignatureConfidence: Number(hint.confidence || 0),
    contentSignatureEvidence: hint.evidence || []
  };
}

function contentSignatureTrace(hint = null, metadata = {}) {
  if (!hint?.signature) {
    return null;
  }
  return {
    stage: "content.signature",
    status: "completed",
    strategy: "content-signature-routing.v1",
    signature: hint.signature,
    confidence: Number(hint.confidence || 0),
    extension: hint.extension || "",
    mediaType: hint.mediaType || "",
    applied: metadata.contentSignature === hint.signature,
    declaredExtension: metadata.declaredExtension || metadata.extension || "",
    declaredMediaType: metadata.declaredMediaType || metadata.mediaType || "",
    evidence: (hint.evidence || []).slice(0, 12)
  };
}

function isStreamableTextRoute(route = null, metadata = {}) {
  if (!route) {
    return false;
  }
  if (["markdown", "plain-text", "markup", "source-code", "config", "diagram", "notebook", "diff", "calendar", "transcript", "financial-report"].includes(route.id)) {
    return true;
  }
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  if (route.id === "spreadsheet" && [".csv", ".tsv"].includes(extension)) {
    return true;
  }
  if (route.id === "json" && [".json", ".jsonc", ".jsonl", ".ndjson"].includes(extension)) {
    return true;
  }
  return false;
}

function isArchiveRoute(route = null) {
  return route?.id === "archive";
}

function isDirectoryRoute(route = null) {
  return route?.id === "directory";
}

function isPdfRoute(route = null) {
  return route?.id === "pdf";
}

function isStructuredZipFileRoute(route = null, metadata = {}) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  if (route?.id === "word") {
    return [".docx", ".docm", ".dotx", ".dotm"].includes(extension);
  }
  if (route?.id === "presentation") {
    return [".pptx", ".pptm", ".ppsx", ".ppsm", ".potx", ".potm"].includes(extension);
  }
  if (route?.id === "visio") {
    return [".vsdx", ".vsdm", ".vssx", ".vssm", ".vstx", ".vstm"].includes(extension);
  }
  if (route?.id === "spreadsheet") {
    return [".xlsx", ".xlsm", ".xltx", ".xltm"].includes(extension);
  }
  if (route?.id === "open-document") {
    return [".odt", ".ott", ".ods", ".ots", ".odp", ".otp"].includes(extension);
  }
  if (route?.id === "ebook") {
    return extension === ".epub";
  }
  return false;
}

function isTikaFileRoute(route = null, metadata = {}) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  if (route?.id === "word") {
    return [".doc", ".dot", ".rtf"].includes(extension);
  }
  if (route?.id === "presentation") {
    return [".ppt", ".pps", ".pot"].includes(extension);
  }
  if (route?.id === "visio") {
    return [".vsd", ".vss", ".vst", ".vdx"].includes(extension);
  }
  if (route?.id === "spreadsheet") {
    return [".xls", ".xlsb"].includes(extension);
  }
  if (route?.id === "email") {
    return isMsgRoute(route, metadata);
  }
  return false;
}

function binaryProfilePayload({ filePath = "", byteSize = 0, suppliedPayloadKind = "file-ref-binary-profile", mode = "binary-profile" } = {}) {
  return {
    buffer: null,
    suppliedPayloadKind,
    filePath,
    binaryProfileFilePath: filePath,
    byteSize,
    parserTrace: [{
      stage: "payload.file-ref",
      status: "completed",
      path: filePath,
      bytes: byteSize,
      mode
    }],
    warnings: []
  };
}

function isMsgRoute(route = null, metadata = {}) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  const mediaType = String(metadata.mediaType || "").toLowerCase();
  return route?.id === "email" && (
    extension === ".msg" ||
    mediaType === "application/vnd.ms-outlook"
  );
}

function isMboxRoute(route = null, metadata = {}) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  const mediaType = String(metadata.mediaType || "").toLowerCase();
  return route?.id === "email" && (
    extension === ".mbox" ||
    mediaType === "application/mbox" ||
    mediaType === "application/x-mbox"
  );
}

function resolveAllowedInputPath(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return { path: "", error: "" };
  }
  const resolved = path.isAbsolute(text) ? path.resolve(text) : path.resolve(DATA_DIR, text);
  const allowed = INPUT_ROOTS.some((root) => isPathInside(resolved, root));
  if (!allowed) {
    return {
      path: "",
      error: `content-ref-outside-allowed-roots:${resolved}`
    };
  }
  return { path: resolved, error: "" };
}

function bufferFromDocument(document = {}, metadata = {}) {
  const encoded =
    document.contentBase64 ||
    document.base64 ||
    document.dataBase64 ||
    document.bytesBase64 ||
    metadata.contentBase64 ||
    metadata.base64 ||
    "";
  if (!encoded) {
    return null;
  }
  try {
    return Buffer.from(String(encoded), "base64");
  } catch (_error) {
    return null;
  }
}

function loadDocumentPayload(document = {}, metadata = {}, route = null) {
  const buffer = bufferFromDocument(document, metadata);
  if (buffer) {
    return {
      buffer,
      suppliedPayloadKind: "base64",
      parserTrace: [],
      warnings: []
    };
  }
  const contentPath = contentPathFromDocument(document, metadata);
  if (!contentPath) {
    return {
      buffer: null,
      suppliedPayloadKind: "metadata-only",
      parserTrace: [],
      warnings: []
    };
  }
  const resolved = resolveAllowedInputPath(contentPath);
  if (resolved.error) {
    return {
      buffer: null,
      suppliedPayloadKind: "file-ref",
      parserTrace: [{
        stage: "payload.file-ref",
        status: "rejected",
        reason: resolved.error,
        allowedRoots: INPUT_ROOTS
      }],
      warnings: ["content-ref-rejected"]
    };
  }
  try {
    const stat = fsSync.statSync(resolved.path);
    if (stat.isDirectory() && isDirectoryRoute(route)) {
      return {
        buffer: null,
        suppliedPayloadKind: "directory-file-ref",
        filePath: resolved.path,
        directoryPath: resolved.path,
        byteSize: 0,
        parserTrace: [{
          stage: "payload.directory-ref",
          status: "completed",
          path: resolved.path,
          mode: "directory-file-ref"
        }],
        warnings: []
      };
    }
    if (!stat.isFile()) {
      return {
        buffer: null,
        suppliedPayloadKind: "file-ref",
        parserTrace: [{
          stage: "payload.file-ref",
          status: "failed",
          path: resolved.path,
          reason: "not-a-file"
        }],
        warnings: ["content-ref-not-file"]
      };
    }
    if (isStreamableTextRoute(route, metadata)) {
      return {
        buffer: null,
        suppliedPayloadKind: "file-ref-stream",
        filePath: resolved.path,
        streamText: true,
        byteSize: stat.size,
        parserTrace: [{
          stage: "payload.file-ref",
          status: "completed",
          path: resolved.path,
          bytes: stat.size,
          mode: "streaming-windowed"
        }],
        warnings: []
      };
    }
    if (isArchiveRoute(route)) {
      return {
        buffer: null,
        suppliedPayloadKind: "file-ref-archive",
        filePath: resolved.path,
        archiveFilePath: resolved.path,
        byteSize: stat.size,
        parserTrace: [{
          stage: "payload.file-ref",
          status: "completed",
          path: resolved.path,
          bytes: stat.size,
          mode: "archive-file-ref"
        }],
        warnings: []
      };
    }
    if (isPdfRoute(route)) {
      return {
        buffer: null,
        suppliedPayloadKind: "file-ref-pdf",
        filePath: resolved.path,
        pdfFilePath: resolved.path,
        byteSize: stat.size,
        parserTrace: [{
          stage: "payload.file-ref",
          status: "completed",
          path: resolved.path,
          bytes: stat.size,
          mode: "pdf-file-ref"
        }],
        warnings: []
      };
    }
    if (isStructuredZipFileRoute(route, metadata)) {
      return {
        buffer: null,
        suppliedPayloadKind: "file-ref-structured-zip",
        filePath: resolved.path,
        structuredZipFilePath: resolved.path,
        byteSize: stat.size,
        parserTrace: [{
          stage: "payload.file-ref",
          status: "completed",
          path: resolved.path,
          bytes: stat.size,
          mode: "structured-zip-file-ref"
        }],
        warnings: []
      };
    }
    if (isMboxRoute(route, metadata)) {
      return {
        buffer: null,
        suppliedPayloadKind: "file-ref-mbox",
        filePath: resolved.path,
        mboxFilePath: resolved.path,
        byteSize: stat.size,
        parserTrace: [{
          stage: "payload.file-ref",
          status: "completed",
          path: resolved.path,
          bytes: stat.size,
          mode: "mbox-file-ref"
        }],
        warnings: []
      };
    }
    if (isTikaFileRoute(route, metadata)) {
      return {
        buffer: null,
        suppliedPayloadKind: "file-ref-tika",
        filePath: resolved.path,
        tikaFilePath: resolved.path,
        byteSize: stat.size,
        parserTrace: [{
          stage: "payload.file-ref",
          status: "completed",
          path: resolved.path,
          bytes: stat.size,
          mode: "tika-file-ref"
        }],
        warnings: []
      };
    }
    if (stat.size > FILE_REF_DIRECT_READ_MAX_BYTES) {
      return binaryProfilePayload({
        filePath: resolved.path,
        byteSize: stat.size,
        suppliedPayloadKind: "file-ref-binary-profile",
        mode: "bounded-binary-profile"
      });
    }
    return {
      buffer: fsSync.readFileSync(resolved.path),
      suppliedPayloadKind: "file-ref",
      filePath: resolved.path,
      byteSize: stat.size,
      parserTrace: [{
        stage: "payload.file-ref",
        status: "completed",
        path: resolved.path,
        bytes: stat.size
      }],
      warnings: []
    };
  } catch (error) {
    return {
      buffer: null,
      suppliedPayloadKind: "file-ref",
      parserTrace: [{
        stage: "payload.file-ref",
        status: "failed",
        path: resolved.path,
        error: error instanceof Error ? error.message : String(error)
      }],
      warnings: ["content-ref-read-failed"]
    };
  }
}

function manifestPathFromInput(input = {}) {
  return String(
    input.rawDocumentsManifestPath ||
      input.documentsManifestPath ||
      input.documentManifestPath ||
      input.sourceManifestPath ||
      input.rawDocumentsManifestRef ||
      input.documentsManifestRef ||
      input.documentManifestRef ||
      input.sourceManifestRef ||
      input.manifestPath ||
      input.manifestRef ||
      ""
  ).trim();
}

function normalizeManifestDocument(record = {}, source = {}) {
  const document = record?.document && typeof record.document === "object"
    ? { ...record.document }
    : { ...record };
  delete document.document;
  if (!contentPathFromDocument(document, document.metadata || {}) && typeof record.path === "string" && record.path.trim()) {
    document.filePath = record.path.trim();
  }
  if (!document.sourceId && source.lineNumber) {
    document.sourceId = stableId("manifest_source", source.manifestPath || "", String(source.lineNumber), document.filePath || document.contentRef || document.fileName || document.title || "");
  }
  document.sourceKind = document.sourceKind || "manifest-entry";
  document.metadata = {
    ...(document.metadata && typeof document.metadata === "object" ? document.metadata : {}),
    manifestPath: source.manifestPath || "",
    manifestLine: source.lineNumber || 0
  };
  return document;
}

function readJsonlDocumentManifest(filePath = "", maxDocuments = MANIFEST_MAX_DOCUMENTS) {
  const documents = [];
  const parserTrace = [];
  const warnings = [];
  const hash = crypto.createHash("sha256");
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  let file = null;
  let pending = "";
  let lineNumber = 0;
  const readLine = (line = "") => {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    if (documents.length >= maxDocuments) {
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        warnings.push(`manifest-line-${lineNumber}-not-object`);
        return;
      }
      documents.push(normalizeManifestDocument(parsed, { manifestPath: filePath, lineNumber }));
    } catch (error) {
      warnings.push(`manifest-line-${lineNumber}-parse-failed`);
      parserTrace.push({
        stage: "input.manifest.jsonl.line",
        status: "failed",
        lineNumber,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
  try {
    file = fsSync.openSync(filePath, "r");
    while (documents.length < maxDocuments) {
      const bytesRead = fsSync.readSync(file, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      pending += decoder.decode(bytes, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        readLine(line);
        if (documents.length >= maxDocuments) {
          break;
        }
      }
    }
    const tail = decoder.decode();
    if (tail) {
      pending += tail;
    }
    if (documents.length < maxDocuments && pending) {
      readLine(pending);
    }
  } finally {
    if (file !== null) {
      fsSync.closeSync(file);
    }
  }
  return {
    documents,
    parserTrace,
    warnings: documents.length >= maxDocuments ? [...warnings, "manifest-document-limit-reached"] : warnings,
    contentHash: `sha256:${hash.digest("hex")}`,
    lineCount: lineNumber,
    truncated: documents.length >= maxDocuments
  };
}

function readJsonDocumentManifest(filePath = "", maxDocuments = MANIFEST_MAX_DOCUMENTS) {
  const stat = fsSync.statSync(filePath);
  if (stat.size > MANIFEST_JSON_DIRECT_READ_MAX_BYTES) {
    return {
      documents: [],
      parserTrace: [{
        stage: "input.manifest.json",
        status: "requires-jsonl-streaming",
        path: filePath,
        bytes: stat.size,
        maxDirectReadBytes: MANIFEST_JSON_DIRECT_READ_MAX_BYTES
      }],
      warnings: ["manifest-json-too-large-use-jsonl"],
      contentHash: "",
      lineCount: 0,
      truncated: false
    };
  }
  const text = fsSync.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text);
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.documents)
      ? parsed.documents
      : Array.isArray(parsed?.rawDocuments)
        ? parsed.rawDocuments
        : [];
  return {
    documents: records
      .filter((record) => record && typeof record === "object" && !Array.isArray(record))
      .slice(0, maxDocuments)
      .map((record, index) => normalizeManifestDocument(record, { manifestPath: filePath, lineNumber: index + 1 })),
    parserTrace: [],
    warnings: records.length > maxDocuments ? ["manifest-document-limit-reached"] : [],
    contentHash: `sha256:${sha(text)}`,
    lineCount: 0,
    truncated: records.length > maxDocuments
  };
}

function loadDocumentManifest(input = {}) {
  const manifestPath = manifestPathFromInput(input);
  if (!manifestPath) {
    return {
      documents: [],
      manifests: [],
      parserTrace: [],
      warnings: []
    };
  }
  const resolved = resolveAllowedInputPath(manifestPath);
  if (resolved.error) {
    const manifest = {
      stage: "input.manifest",
      status: "rejected",
      path: manifestPath,
      reason: resolved.error,
      allowedRoots: INPUT_ROOTS,
      documentCount: 0
    };
    return {
      documents: [],
      manifests: [manifest],
      parserTrace: [manifest],
      warnings: ["manifest-ref-rejected"]
    };
  }
  try {
    const stat = fsSync.statSync(resolved.path);
    if (!stat.isFile()) {
      const manifest = {
        stage: "input.manifest",
        status: "failed",
        path: resolved.path,
        reason: "not-a-file",
        documentCount: 0
      };
      return {
        documents: [],
        manifests: [manifest],
        parserTrace: [manifest],
        warnings: ["manifest-ref-not-file"]
      };
    }
    const extension = normalizeExtension(extensionFromFileName(resolved.path));
    const isJson = extension === ".json";
    const parsed = isJson
      ? readJsonDocumentManifest(resolved.path)
      : readJsonlDocumentManifest(resolved.path);
    const manifest = {
      stage: isJson ? "input.manifest.json" : "input.manifest.jsonl",
      status: parsed.documents.length ? "completed" : parsed.warnings.length ? "warning" : "empty",
      path: resolved.path,
      bytes: stat.size,
      format: isJson ? "json" : "jsonl",
      documentCount: parsed.documents.length,
      lineCount: parsed.lineCount || 0,
      contentHash: parsed.contentHash || "",
      maxDocuments: MANIFEST_MAX_DOCUMENTS,
      truncated: Boolean(parsed.truncated)
    };
    return {
      documents: parsed.documents,
      manifests: [manifest],
      parserTrace: [manifest, ...(parsed.parserTrace || [])],
      warnings: parsed.warnings || []
    };
  } catch (error) {
    const manifest = {
      stage: "input.manifest",
      status: "failed",
      path: resolved.path,
      error: error instanceof Error ? error.message : String(error),
      documentCount: 0
    };
    return {
      documents: [],
      manifests: [manifest],
      parserTrace: [manifest],
      warnings: ["manifest-read-failed"]
    };
  }
}

function inputDocumentArray(value) {
  return Array.isArray(value) ? value : [];
}

function inlineDocumentInput(input = {}) {
  const normalizedDocumentSet =
    input.normalizedDocumentSet && typeof input.normalizedDocumentSet === "object"
      ? input.normalizedDocumentSet
      : input.parsedDocumentSet && typeof input.parsedDocumentSet === "object"
        ? input.parsedDocumentSet
        : null;
  const candidates = [
    {
      field: "normalizedDocumentSet.documents",
      contract: String(normalizedDocumentSet?.contract || normalizedDocumentSet?.documentInputContract || ""),
      documents: inputDocumentArray(normalizedDocumentSet?.documents)
    },
    {
      field: "normalizedDocuments",
      contract: DISTILLATION_DOCUMENT_INPUT_CONTRACT,
      documents: inputDocumentArray(input.normalizedDocuments)
    },
    {
      field: "documents",
      contract: DISTILLATION_DOCUMENT_INPUT_CONTRACT,
      documents: inputDocumentArray(input.documents)
    },
    {
      field: "rawDocuments",
      contract: "legacy.raw-documents",
      documents: inputDocumentArray(input.rawDocuments)
    }
  ];
  return candidates.find((candidate) => candidate.documents.length > 0) || {
    field: "",
    contract: "",
    documents: []
  };
}

function collectInputDocuments(input = {}) {
  const inlineInput = inlineDocumentInput(input);
  const inlineDocuments = inlineInput.documents;
  const manifest = loadDocumentManifest(input);
  return {
    documents: [...inlineDocuments, ...manifest.documents],
    inlineDocumentCount: inlineDocuments.length,
    inlineDocumentField: inlineInput.field,
    inlineDocumentContract: inlineInput.contract,
    manifestDocumentCount: manifest.documents.length,
    manifests: manifest.manifests,
    parserTrace: manifest.parserTrace,
    warnings: manifest.warnings
  };
}

function utf8(buffer) {
  return Buffer.from(buffer || []).toString("utf8").replace(/^\uFEFF/, "");
}

function decodeXmlEntities(value = "") {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripMarkup(value = "") {
  return decodeXmlEntities(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactMarkupText(value = "", limit = 1200) {
  return decodeXmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim()
    .slice(0, limit);
}

function markupFormatFromMetadata(metadata = {}) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  const mediaType = String(metadata.mediaType || "").toLowerCase();
  if ([".html", ".htm", ".xhtml"].includes(extension)) return "html";
  if (extension === ".xml") return "xml";
  if (extension === ".rst") return "rst";
  if (extension === ".adoc" || extension === ".asciidoc") return "asciidoc";
  if (extension === ".org") return "org";
  if (extension === ".tex" || extension === ".latex") return "latex";
  if (extension === ".wiki" || extension === ".mediawiki") return "mediawiki";
  if (mediaType.includes("asciidoc")) return "asciidoc";
  if (mediaType.includes("mediawiki")) return "mediawiki";
  if (mediaType.includes("latex") || mediaType.includes("tex")) return "latex";
  if (mediaType.includes("html")) return "html";
  if (mediaType.includes("xml")) return "xml";
  if (mediaType.includes("rst")) return "rst";
  if (mediaType.includes("org")) return "org";
  return "markup";
}

function pushMarkupElement(elements, type, text, metadata = {}) {
  const normalized = compactMarkupText(text, metadata.limit || 1200);
  if (!normalized) {
    return;
  }
  elements.push({
    type,
    text: normalized,
    ...(metadata.level ? { level: metadata.level } : {}),
    ...(metadata.line ? { line: metadata.line } : {}),
    ...(metadata.href ? { href: metadata.href } : {}),
    ...(metadata.name ? { name: metadata.name } : {})
  });
}

function pushStructureElement(elements, type, text, metadata = {}) {
  const normalized = compactMarkupText(text, metadata.limit || 1200);
  if (!normalized) {
    return;
  }
  elements.push({
    type,
    text: normalized,
    ...(metadata.level ? { level: metadata.level } : {}),
    ...(metadata.line ? { line: metadata.line } : {}),
    ...(metadata.href ? { href: metadata.href } : {}),
    ...(metadata.name ? { name: metadata.name } : {}),
    ...(metadata.page ? { page: metadata.page } : {}),
    ...(metadata.bbox ? { bbox: metadata.bbox } : {}),
    ...(metadata.layout ? { layout: metadata.layout } : {}),
    ...(metadata.table ? { table: metadata.table } : {}),
    ...(metadata.annotation ? { annotation: metadata.annotation } : {}),
    ...(metadata.style ? { style: metadata.style } : {}),
    ...(metadata.shape ? { shape: metadata.shape } : {}),
    ...(metadata.presentation ? { presentation: metadata.presentation } : {}),
    ...(metadata.image ? { image: metadata.image } : {}),
    ...(metadata.chart ? { chart: metadata.chart } : {}),
    ...(metadata.form ? { form: metadata.form } : {}),
    ...(metadata.control ? { control: metadata.control } : {}),
    ...(metadata.bookmark ? { bookmark: metadata.bookmark } : {}),
    ...(metadata.headerFooter ? { headerFooter: metadata.headerFooter } : {}),
    ...(metadata.definedName ? { definedName: metadata.definedName } : {}),
    ...(metadata.codeBlock ? { codeBlock: metadata.codeBlock } : {}),
    ...(metadata.quote ? { quote: metadata.quote } : {}),
    ...(metadata.merge ? { merge: metadata.merge } : {}),
    ...(metadata.frontmatter ? { frontmatter: metadata.frontmatter } : {}),
    ...(metadata.cells ? { cells: metadata.cells } : {}),
    ...(metadata.transcript ? { transcript: metadata.transcript } : {}),
    ...(metadata.xbrlFact ? { xbrlFact: metadata.xbrlFact } : {})
  });
}

function xmlLocalAttribute(tag = "", localName = "") {
  const pattern = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${localName}=(["'])(.*?)\\1`, "i");
  return decodeXmlEntities(String(tag || "").match(pattern)?.[2] || "");
}

function fallbackStructureFormat(route = null, metadata = {}) {
  const extensionFormat = normalizeExtension(metadata.extension || "").replace(/^\./, "");
  if (route?.id === "pdf") return "pdf";
  if (route?.id === "word") return extensionFormat || "word";
  if (route?.id === "presentation") return extensionFormat || "presentation";
  if (route?.id === "visio") return extensionFormat || "vsdx";
  if (route?.id === "spreadsheet") return extensionFormat || "table";
  if (route?.id === "open-document") return "open-document";
  if (route?.id === "ebook") return "epub";
  return extensionFormat || route?.id || "";
}

function supportsFallbackStructureElements(route = null) {
  return ["pdf", "word", "presentation", "visio", "spreadsheet", "open-document", "ebook"].includes(route?.id);
}

function lineLooksLikeTableRow(line = "", route = null) {
  return route?.id === "spreadsheet" ||
    /\b[A-Z]{1,3}\d+=/.test(line) ||
    /\s\|\s/.test(line) ||
    /^\|.+\|$/.test(line);
}

function lineLooksLikeHeading(line = "") {
  return /^(?:title|page|slide|sheet|chapter|section|part)\s+\d*\b[:：]?/i.test(line) ||
    /^(?:#{1,6}|\d+(?:\.\d+){0,5}[.)、])\s+\S/.test(line);
}

function buildFallbackStructureElementsFromText(text = "", route = null, metadata = {}) {
  if (!supportsFallbackStructureElements(route)) {
    return [];
  }
  const elements = [];
  const title = String(metadata.title || metadata.fileName || "").trim();
  if (title) {
    pushStructureElement(elements, "title", title, { line: 1 });
  }
  const lines = String(text || "").split(/\r?\n/);
  let paragraph = [];
  let paragraphLine = 0;
  let tableRows = 0;
  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    pushStructureElement(elements, "paragraph", paragraph.join(" "), { line: paragraphLine });
    paragraph = [];
    paragraphLine = 0;
  };
  for (const [index, rawLine] of lines.entries()) {
    if (elements.length >= 2000) {
      flushParagraph();
      break;
    }
    const line = compactMarkupText(rawLine, 1200);
    if (!line) {
      flushParagraph();
      continue;
    }
    const lineNumber = index + 1;
    const titleMatch = line.match(/^(?:title|document title)\s*[:：]\s*(.+)$/i);
    if (titleMatch) {
      flushParagraph();
      pushStructureElement(elements, "title", titleMatch[1], { line: lineNumber });
      continue;
    }
    if (lineLooksLikeTableRow(line, route)) {
      flushParagraph();
      const elementType = route?.id === "spreadsheet" && (tableRows === 0 || /header row/i.test(line))
        ? "table-header"
        : "table-row";
      tableRows += 1;
      pushStructureElement(elements, elementType, line, { line: lineNumber });
      continue;
    }
    if (/^(?:[-*+]|\d+[.)、])\s+\S/.test(line)) {
      flushParagraph();
      pushStructureElement(elements, "list-item", line.replace(/^(?:[-*+]|\d+[.)、])\s+/, ""), { line: lineNumber });
      continue;
    }
    if (/^(?:```| {4,}|\t)/.test(rawLine)) {
      flushParagraph();
      pushStructureElement(elements, "code", line, { line: lineNumber });
      continue;
    }
    if (lineLooksLikeHeading(line)) {
      flushParagraph();
      pushStructureElement(elements, "heading", line.replace(/^#{1,6}\s+/, ""), { line: lineNumber, level: 2 });
      continue;
    }
    if (!paragraphLine) {
      paragraphLine = lineNumber;
    }
    paragraph.push(line);
    if (paragraph.join(" ").length >= 900) {
      flushParagraph();
    }
  }
  flushParagraph();
  return elements;
}

function stripMarkdownInline(value = "") {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]{1,3}/g, "")
    .trim();
}

function markdownTableCells(line = "", options = {}) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("|")) {
    return [];
  }
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => (options.raw ? cell.trim() : stripMarkdownInline(cell.trim())));
}

function isMarkdownTableDelimiter(line = "") {
  const cells = markdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownFrontmatterValue(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return { value: "", valueText: "", valueType: "empty" };
  }
  const unquote = (item = "") => String(item || "").trim().replace(/^['"]|['"]$/g, "");
  if (/^\[[\s\S]*\]$/.test(trimmed)) {
    const items = trimmed
      .slice(1, -1)
      .split(",")
      .map(unquote)
      .filter(Boolean);
    return { value: items, valueText: items.join(", "), valueType: "array" };
  }
  if (/^(?:true|false)$/i.test(trimmed)) {
    return { value: /^true$/i.test(trimmed), valueText: trimmed.toLowerCase(), valueType: "boolean" };
  }
  if (/^-?(?:\d+\.\d+|\d+)$/.test(trimmed)) {
    return { value: Number(trimmed), valueText: trimmed, valueType: "number" };
  }
  return { value: unquote(trimmed), valueText: unquote(trimmed), valueType: "string" };
}

function parseMarkdownFrontmatterEntry(line = "", format = "yaml") {
  const raw = String(line || "");
  const pattern = format === "toml"
    ? /^\s*([A-Za-z0-9_.-]+)\s*=\s*([\s\S]*?)\s*$/
    : /^\s*([A-Za-z0-9_.-]+)\s*:\s*([\s\S]*?)\s*$/;
  const match = raw.match(pattern);
  if (!match) {
    const { value, valueText, valueType } = parseMarkdownFrontmatterValue(raw.trim());
    return { format, key: "", value, valueText, valueType, raw: raw.trim() };
  }
  const { value, valueText, valueType } = parseMarkdownFrontmatterValue(match[2]);
  return {
    format,
    key: match[1],
    value,
    valueText,
    valueType,
    raw: raw.trim()
  };
}

function parseMarkdownText(text = "", metadata = {}) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const elements = [];
  let inCode = false;
  let codeFence = "";
  let codeFenceMarker = "";
  let codeLanguage = "";
  let codeLines = [];
  let codeStartLine = 0;
  let paragraph = [];
  let paragraphLine = 0;
  let tableHeader = [];
  let tableRows = 0;
  let frontmatter = false;
  let frontmatterFence = "";
  let frontmatterCount = 0;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    pushStructureElement(elements, "paragraph", stripMarkdownInline(paragraph.join(" ")), { line: paragraphLine });
    paragraph = [];
    paragraphLine = 0;
  };

  const flushCode = (lineEnd = 0) => {
    if (!codeLines.length) {
      codeStartLine = 0;
      codeFence = "";
      codeFenceMarker = "";
      codeLanguage = "";
      return;
    }
    pushStructureElement(elements, "code", codeLines.join("\n"), {
      line: codeStartLine,
      name: codeLanguage || "code",
      codeBlock: {
        kind: "markdown-code-fence",
        fence: codeFenceMarker || codeFence,
        language: codeLanguage,
        lineStart: codeStartLine,
        lineEnd: lineEnd || codeStartLine + codeLines.length,
        lineCount: codeLines.length
      },
      limit: 4000
    });
    codeLines = [];
    codeStartLine = 0;
    codeFence = "";
    codeFenceMarker = "";
    codeLanguage = "";
  };

  for (let index = 0; index < lines.length && elements.length < 2000; index += 1) {
    const raw = lines[index] || "";
    const lineNumber = index + 1;
    const trimmed = raw.trim();

    if (lineNumber === 1 && ["---", "+++"].includes(trimmed)) {
      frontmatter = true;
      frontmatterFence = trimmed;
      continue;
    }
    if (frontmatter) {
      if (trimmed === frontmatterFence) {
        frontmatter = false;
        frontmatterFence = "";
      } else if (trimmed) {
        const entry = parseMarkdownFrontmatterEntry(trimmed, frontmatterFence === "+++" ? "toml" : "yaml");
        frontmatterCount += 1;
        pushStructureElement(elements, "frontmatter", entry.key ? `${entry.key}: ${entry.valueText}` : entry.valueText, {
          line: lineNumber,
          name: "markdown-frontmatter",
          frontmatter: entry,
          limit: 1200
        });
      }
      continue;
    }

    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      if (inCode) {
        if (!codeFenceMarker || fenceMatch[1][0] === codeFenceMarker[0]) {
          flushCode(lineNumber);
          inCode = false;
        } else {
          codeLines.push(raw);
        }
      } else {
        flushParagraph();
        inCode = true;
        codeFence = trimmed;
        codeFenceMarker = fenceMatch[1];
        codeLanguage = String(fenceMatch[2] || "").trim().split(/\s+/)[0] || "";
        codeStartLine = lineNumber;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(raw);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      tableHeader = [];
      tableRows = 0;
      continue;
    }

    const setextCandidate = index + 1 < lines.length ? lines[index + 1].trim() : "";
    if (trimmed && /^[=-]{3,}$/.test(setextCandidate)) {
      flushParagraph();
      pushStructureElement(elements, "heading", stripMarkdownInline(trimmed), {
        level: setextCandidate.startsWith("=") ? 1 : 2,
        line: lineNumber
      });
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph();
      pushStructureElement(elements, "heading", stripMarkdownInline(heading[2]), {
        level: heading[1].length,
        line: lineNumber
      });
      continue;
    }

    if (trimmed.startsWith("|") && isMarkdownTableDelimiter(lines[index + 1] || "")) {
      flushParagraph();
      tableHeader = markdownTableCells(trimmed);
      tableRows = 0;
      pushStructureElement(elements, "table-header", tableHeader.map((cell, cellIndex) => `${xlsxColumnLabel("", cellIndex)}=${cell}`).join("; "), {
        line: lineNumber,
        name: "markdown-table",
        table: {
          format: "markdown",
          row: 1,
          columns: tableHeader.length
        },
        cells: tableHeader.map((cell, cellIndex) => ({
          ref: `${xlsxColumnLabel("", cellIndex)}1`,
          column: xlsxColumnLabel("", cellIndex),
          row: 1,
          value: cell
        })),
        limit: 2000
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("|") && tableHeader.length) {
      flushParagraph();
      tableRows += 1;
      const cells = markdownTableCells(trimmed);
      pushStructureElement(elements, "table-row", cells.map((cell, cellIndex) => {
        const header = tableHeader[cellIndex] || xlsxColumnLabel("", cellIndex);
        return `${xlsxColumnLabel("", cellIndex)}${tableRows + 1} ${header}=${cell}`;
      }).join("; "), {
        line: lineNumber,
        name: "markdown-table",
        table: {
          format: "markdown",
          row: tableRows + 1,
          columns: cells.length
        },
        cells: cells.map((cell, cellIndex) => ({
          ref: `${xlsxColumnLabel("", cellIndex)}${tableRows + 1}`,
          column: xlsxColumnLabel("", cellIndex),
          row: tableRows + 1,
          header: tableHeader[cellIndex] || "",
          value: cell
        })),
        limit: 2000
      });
      continue;
    }

    tableHeader = [];
    tableRows = 0;

    const image = trimmed.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (image) {
      flushParagraph();
      pushStructureElement(elements, "image", image[1] || image[2], { line: lineNumber, href: image[2], limit: 500 });
      continue;
    }

    for (const match of trimmed.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      pushStructureElement(elements, "link", match[1], { line: lineNumber, href: match[2], limit: 500 });
    }

    if (/^(?:[-*+]|\d+[.)])\s+\S/.test(trimmed)) {
      flushParagraph();
      pushStructureElement(elements, "list-item", stripMarkdownInline(trimmed.replace(/^(?:[-*+]|\d+[.)])\s+/, "")), { line: lineNumber });
      continue;
    }

    if (/^>+\s*\S/.test(trimmed)) {
      flushParagraph();
      const quoteMatch = trimmed.match(/^(>+)\s*(.*)$/);
      const quoteDepth = quoteMatch?.[1]?.length || 1;
      pushStructureElement(elements, "blockquote", stripMarkdownInline(quoteMatch?.[2] || trimmed.replace(/^>\s+/, "")), {
        line: lineNumber,
        quote: {
          kind: "markdown-blockquote",
          depth: quoteDepth,
          lineStart: lineNumber,
          lineEnd: lineNumber
        }
      });
      continue;
    }

    if (!paragraphLine) {
      paragraphLine = lineNumber;
    }
    paragraph.push(trimmed);
  }

  if (inCode) {
    flushCode();
  }
  flushParagraph();
  if (!elements.length) {
    pushStructureElement(elements, "paragraph", text, { line: 1, limit: 6000 });
  }
  const counts = elementTypeCounts(elements);
  return {
    text: structureElementsToText("markdown", elements, String(text || "").trim()),
    elements,
    format: "markdown",
    headingCount: counts.heading || 0,
    listItemCount: counts["list-item"] || 0,
    tableCount: (counts["table-header"] || 0) + (counts["table-row"] || 0),
    codeBlockCount: counts.code || 0,
    blockquoteCount: counts.blockquote || 0,
    linkCount: counts.link || 0,
    imageCount: counts.image || 0,
    frontmatterCount: counts.frontmatter || frontmatterCount,
    metadataCount: counts.frontmatter || frontmatterCount
  };
}

function parseHtmlMarkupElements(text = "") {
  const source = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const elements = [];
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    pushMarkupElement(elements, "title", title[1]);
  }
  for (const match of source.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    pushMarkupElement(elements, "heading", match[2], { level: Number(match[1]) });
  }
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    pushMarkupElement(elements, "link", match[2], { href: decodeXmlEntities(href), limit: 500 });
  }
  for (const match of source.matchAll(/<(?:pre|code)[^>]*>([\s\S]*?)<\/(?:pre|code)>/gi)) {
    pushMarkupElement(elements, "code", match[1], { limit: 1500 });
  }
  for (const match of source.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    pushMarkupElement(elements, "table-row", match[1], { limit: 1500 });
  }
  for (const match of source.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    pushMarkupElement(elements, "list-item", match[1], { limit: 700 });
  }
  for (const match of source.matchAll(/<(?:p|article|section|blockquote)[^>]*>([\s\S]*?)<\/(?:p|article|section|blockquote)>/gi)) {
    pushMarkupElement(elements, "paragraph", match[1], { limit: 1200 });
    if (elements.length >= 400) break;
  }
  if (!elements.length) {
    pushMarkupElement(elements, "text", stripMarkup(source), { limit: 4000 });
  }
  return elements.slice(0, 600);
}

function parseXmlMarkupElements(text = "") {
  const source = String(text || "");
  const elements = [];
  const seenTags = new Set();
  for (const match of source.matchAll(/<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]{0,4000}?)<\/\1>/g)) {
    const tag = match[1];
    const value = stripMarkup(match[2]);
    if (!value || value.length > 1600) {
      continue;
    }
    seenTags.add(tag);
    pushMarkupElement(elements, /title|name|heading|subject/i.test(tag) ? "heading" : "xml-field", value, { name: tag });
    if (elements.length >= 400) {
      break;
    }
  }
  if (seenTags.size) {
    pushMarkupElement(elements, "schema", Array.from(seenTags).slice(0, 80).join(", "));
  }
  if (!elements.length) {
    pushMarkupElement(elements, "text", stripMarkup(source), { limit: 4000 });
  }
  return elements.slice(0, 600);
}

function parseLineMarkupElements(text = "", format = "markup") {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const elements = [];
  let inCode = false;
  for (let index = 0; index < lines.length && elements.length < 800; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] || "";
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (format === "rst" && index + 1 < lines.length && /^[=\-~`^"']{3,}\s*$/.test(lines[index + 1].trim())) {
      pushMarkupElement(elements, "heading", trimmed, { level: lines[index + 1].trim()[0] === "=" ? 1 : 2, line: lineNumber });
      index += 1;
      continue;
    }
    if (format === "asciidoc") {
      const heading = trimmed.match(/^(={1,6})\s+(.+)$/);
      if (heading) {
        pushMarkupElement(elements, "heading", heading[2], { level: heading[1].length, line: lineNumber });
        continue;
      }
      const attribute = trimmed.match(/^:([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (attribute) {
        pushMarkupElement(elements, "attribute", `${attribute[1]}: ${attribute[2]}`, { line: lineNumber });
        continue;
      }
      const include = trimmed.match(/^(include|image)::([^\[]+)/);
      if (include) {
        pushMarkupElement(elements, include[1], include[2], { line: lineNumber });
        continue;
      }
    }
    if (format === "org") {
      const heading = trimmed.match(/^(\*{1,8})\s+(?:(TODO|DONE|WAITING|CANCELLED)\s+)?(.+)$/);
      if (heading) {
        pushMarkupElement(elements, heading[2] ? "task-heading" : "heading", `${heading[2] ? `${heading[2]} ` : ""}${heading[3]}`, { level: heading[1].length, line: lineNumber });
        continue;
      }
      const keyword = trimmed.match(/^#\+([A-Za-z0-9_-]+):\s*(.*)$/);
      if (keyword) {
        pushMarkupElement(elements, "attribute", `${keyword[1]}: ${keyword[2]}`, { line: lineNumber });
        continue;
      }
    }
    if (format === "mediawiki") {
      const heading = trimmed.match(/^(={2,6})\s*(.*?)\s*\1$/);
      if (heading) {
        pushMarkupElement(elements, "heading", heading[2], { level: Math.max(1, heading[1].length - 1), line: lineNumber });
        continue;
      }
    }
    if (format === "rst") {
      const directive = trimmed.match(/^\.\.\s+([A-Za-z0-9_-]+)::\s*(.*)$/);
      if (directive) {
        pushMarkupElement(elements, "directive", `${directive[1]}: ${directive[2]}`, { line: lineNumber });
        if (/code|sourcecode/i.test(directive[1])) {
          inCode = true;
        }
        continue;
      }
      const field = trimmed.match(/^:([A-Za-z0-9_. -]+):\s*(.*)$/);
      if (field) {
        pushMarkupElement(elements, "field", `${field[1]}: ${field[2]}`, { line: lineNumber });
        continue;
      }
    }
    if (/^(```|----|\.\.\s+code-block::)/.test(trimmed)) {
      inCode = !inCode;
      pushMarkupElement(elements, "code-boundary", trimmed, { line: lineNumber });
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed) || (format === "mediawiki" && /^[*#;:]+\s*/.test(trimmed))) {
      pushMarkupElement(elements, "list-item", trimmed.replace(/^[-*+#;:\d.)\s]+/, ""), { line: lineNumber });
      continue;
    }
    for (const match of trimmed.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)]+)\)|link:([^\[]+)\[([^\]]*)\]/g)) {
      const href = match[1] || match[4] || match[5] || "";
      const label = match[2] || match[3] || match[6] || href;
      pushMarkupElement(elements, "link", label, { href, line: lineNumber });
    }
    if (trimmed.startsWith("|")) {
      pushMarkupElement(elements, "table-row", trimmed, { line: lineNumber });
      continue;
    }
    if (inCode || /^\s{2,}\S/.test(line)) {
      pushMarkupElement(elements, "code", trimmed, { line: lineNumber, limit: 1500 });
      continue;
    }
    pushMarkupElement(elements, "paragraph", trimmed, { line: lineNumber });
  }
  return elements;
}

function parseLatexMarkupElements(text = "") {
  const source = String(text || "");
  const elements = [];
  for (const match of source.matchAll(/\\(title|author|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{([^{}]+)\}/g)) {
    const command = match[1];
    const level = command === "chapter" ? 1 : command === "section" ? 2 : command === "subsection" ? 3 : command === "subsubsection" ? 4 : 0;
    pushMarkupElement(elements, command === "title" || /section|chapter|paragraph/.test(command) ? "heading" : "metadata", match[2], { level });
  }
  for (const match of source.matchAll(/\\(begin|end)\{([^{}]+)\}/g)) {
    pushMarkupElement(elements, "environment", `${match[1]} ${match[2]}`, { name: match[2], limit: 300 });
  }
  for (const match of source.matchAll(/\\(?:cite|parencite|textcite)\{([^{}]+)\}/g)) {
    pushMarkupElement(elements, "citation", match[1], { limit: 500 });
  }
  for (const match of source.matchAll(/\\(?:ref|label)\{([^{}]+)\}/g)) {
    pushMarkupElement(elements, "reference", match[1], { limit: 500 });
  }
  for (const match of source.matchAll(/\$\$?([^$\n]{2,500})\$\$?/g)) {
    pushMarkupElement(elements, "formula", match[1], { limit: 500 });
  }
  for (const match of source.matchAll(/\\item\s+([^\n]+)/g)) {
    pushMarkupElement(elements, "list-item", match[1], { limit: 800 });
  }
  if (elements.length < 30) {
    const cleaned = source
      .replace(/%.*$/gm, "")
      .replace(/\\(title|author|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{([^{}]+)\}/g, "$2\n")
      .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, "$1 ")
      .replace(/[{}]/g, " ");
    for (const paragraph of cleaned.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).slice(0, 120)) {
      pushMarkupElement(elements, "paragraph", paragraph, { limit: 1200 });
    }
  }
  return elements.slice(0, 800);
}

function elementTypeCounts(elements = []) {
  const counts = {};
  for (const element of elements) {
    counts[element.type] = (counts[element.type] || 0) + 1;
  }
  return counts;
}

function markupElementsToText(format = "markup", elements = [], fallback = "") {
  const records = [`Markup format: ${format}`];
  for (const element of elements.slice(0, 700)) {
    const level = element.level ? ` level ${element.level}` : "";
    const line = element.line ? ` line ${element.line}` : "";
    const name = element.name ? ` ${element.name}` : "";
    const href = element.href ? ` -> ${element.href}` : "";
    records.push(`Markup ${element.type}${level}${name}${line}: ${element.text}${href}`);
  }
  if (records.length === 1 && fallback) {
    records.push(`Markup text: ${compactMarkupText(fallback, 4000)}`);
  }
  return records.filter(Boolean).join("\n");
}

function parseMarkupText(text = "", metadata = {}) {
  const format = markupFormatFromMetadata(metadata);
  let elements;
  if (format === "html") {
    elements = parseHtmlMarkupElements(text);
  } else if (format === "xml") {
    elements = parseXmlMarkupElements(text);
  } else if (format === "latex") {
    elements = parseLatexMarkupElements(text);
  } else {
    elements = parseLineMarkupElements(text, format);
  }
  const counts = elementTypeCounts(elements);
  const fallback = format === "html" || format === "xml" ? stripMarkup(text) : String(text || "").trim();
  return {
    text: markupElementsToText(format, elements, fallback),
    format,
    elements,
    elementCount: elements.length,
    headingCount: (counts.heading || 0) + (counts["task-heading"] || 0) + (counts.title || 0),
    listItemCount: counts["list-item"] || 0,
    linkCount: counts.link || 0,
    tableCount: counts["table-row"] || 0,
    codeBlockCount: (counts.code || 0) + (counts["code-boundary"] || 0),
    formulaCount: counts.formula || 0
  };
}

function textFromXmlTextNodes(xml = "") {
  const values = [];
  for (const match of String(xml || "").matchAll(/<[^:>]*:?t(?:\s[^>]*)?>([\s\S]*?)<\/[^:>]*:?t>/g)) {
    values.push(decodeXmlEntities(match[1]));
  }
  if (values.length) {
    return values.join(" ").replace(/\s+/g, " ").trim();
  }
  return stripMarkup(xml);
}

function parseJsonLike(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("\n") && !trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    const records = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 500)
      .map((line, index) => {
        try {
          return `Record ${index + 1}: ${JSON.stringify(JSON.parse(line))}`;
        } catch (_error) {
          return `Record ${index + 1}: ${line}`;
        }
      });
    return records.join("\n");
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch (_error) {
    return trimmed;
  }
}

function notebookCellSource(cell = {}) {
  const source = cell?.source ?? "";
  if (Array.isArray(source)) {
    return source.join("");
  }
  return String(source || "");
}

function notebookOutputText(output = {}) {
  const data = output?.data && typeof output.data === "object" ? output.data : {};
  const text = output?.text ?? data["text/plain"] ?? output?.ename ?? "";
  if (Array.isArray(text)) {
    return text.join("");
  }
  return String(text || "");
}

function parseNotebookText(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return {
      text: "",
      cellCount: 0,
      markdownCount: 0,
      codeCount: 0,
      outputCount: 0,
      fallback: false
    };
  }
  try {
    const notebook = JSON.parse(trimmed);
    const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
    const records = [];
    const metadata = notebook?.metadata && typeof notebook.metadata === "object" ? notebook.metadata : {};
    const language = metadata.language_info?.name || metadata.kernelspec?.language || metadata.kernelspec?.name || "";
    if (language) {
      records.push(`Notebook language: ${language}`);
    }
    let markdownCount = 0;
    let codeCount = 0;
    let outputCount = 0;
    for (const [index, cell] of cells.slice(0, 1000).entries()) {
      const cellType = String(cell?.cell_type || "unknown");
      const source = notebookCellSource(cell).replace(/\r\n/g, "\n").trim();
      if (cellType === "markdown") {
        markdownCount += 1;
      }
      if (cellType === "code") {
        codeCount += 1;
      }
      if (source) {
        records.push(`Notebook ${cellType} cell ${index + 1}: ${source.replace(/\s+/g, " ").slice(0, 1800)}`);
      }
      const outputs = Array.isArray(cell?.outputs) ? cell.outputs : [];
      for (const [outputIndex, output] of outputs.slice(0, 5).entries()) {
        const outputText = notebookOutputText(output).replace(/\r\n/g, "\n").trim();
        if (outputText) {
          outputCount += 1;
          records.push(`Notebook output cell ${index + 1}.${outputIndex + 1}: ${outputText.replace(/\s+/g, " ").slice(0, 1000)}`);
        }
      }
    }
    return {
      text: records.join("\n"),
      cellCount: cells.length,
      markdownCount,
      codeCount,
      outputCount,
      fallback: false
    };
  } catch (_error) {
    return {
      text: parseJsonLike(trimmed),
      cellCount: 0,
      markdownCount: 0,
      codeCount: 0,
      outputCount: 0,
      fallback: true
    };
  }
}

function sourceLanguageFromMetadata(metadata = {}) {
  const explicit = String(metadata.language || metadata.lang || "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  const languages = {
    ".js": "javascript",
    ".mjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript-react",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".swift": "swift",
    ".kt": "kotlin",
    ".c": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".h": "c-header",
    ".hpp": "cpp-header"
  };
  return languages[extension] || extension.replace(/^\./, "") || "source";
}

function parseSourceCodeText(text = "", metadata = {}) {
  const language = sourceLanguageFromMetadata(metadata);
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const records = [`Code language: ${language}`];
  const imports = [];
  const symbols = [];
  const entryPoints = [];
  const todos = [];

  const pushUnique = (target, value) => {
    if (!value || target.includes(value)) {
      return;
    }
    target.push(value);
  };

  const pushImport = (lineNumber, value) => pushUnique(imports, `line ${lineNumber}: ${value.trim()}`);
  const pushSymbol = (lineNumber, kind, name) => pushUnique(symbols, `${kind} ${name} line ${lineNumber}`);
  const pushEntry = (lineNumber, value) => pushUnique(entryPoints, `line ${lineNumber}: ${value.trim()}`);
  const pushTodo = (lineNumber, value) => pushUnique(todos, `line ${lineNumber}: ${value.trim().slice(0, 220)}`);

  for (const [index, rawLine] of lines.slice(0, 20_000).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
      pushTodo(lineNumber, line);
    }

    let match;
    if (/^(javascript|typescript|typescript-react)$/.test(language)) {
      if (/^(import\s|export\s+\{)|\brequire\s*\(/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/);
      if (match) pushSymbol(lineNumber, "function", match[1]);
      match = line.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
      if (match) pushSymbol(lineNumber, "class", match[1]);
      match = line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?/);
      if (match) pushSymbol(lineNumber, "binding", match[1]);
      match = line.match(/^(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\b/);
      if (match) pushSymbol(lineNumber, "type", match[1]);
      if (line.includes("createServer(") || line.includes("listen(")) {
        pushEntry(lineNumber, line);
      }
      continue;
    }

    if (language === "python") {
      if (/^(import|from)\s+/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/);
      if (match) pushSymbol(lineNumber, "function", match[1]);
      match = line.match(/^class\s+([A-Za-z_][\w]*)\b/);
      if (match) pushSymbol(lineNumber, "class", match[1]);
      if (line.includes("__name__") && line.includes("__main__")) {
        pushEntry(lineNumber, line);
      }
      continue;
    }

    if (language === "go") {
      if (/^import\b/.test(line) || /^package\s+/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/);
      if (match) pushSymbol(lineNumber, "function", match[1]);
      if (/^func\s+main\s*\(/.test(line)) {
        pushEntry(lineNumber, line);
      }
      continue;
    }

    if (language === "rust") {
      if (/^(use|mod)\s+/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/);
      if (match) pushSymbol(lineNumber, "function", match[1]);
      match = line.match(/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)\b/);
      if (match) pushSymbol(lineNumber, "type", match[1]);
      if (/^fn\s+main\s*\(/.test(line)) {
        pushEntry(lineNumber, line);
      }
      continue;
    }

    if (language === "swift") {
      if (/^import\s+/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/^(?:public\s+|private\s+|internal\s+)?(?:func|class|struct|enum|protocol)\s+([A-Za-z_]\w*)\b/);
      if (match) pushSymbol(lineNumber, line.split(/\s+/)[0], match[1]);
      if (/@main\b/.test(line)) {
        pushEntry(lineNumber, line);
      }
      continue;
    }

    if (language === "kotlin") {
      if (/^import\s+/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/^(?:data\s+)?(?:class|object|interface)\s+([A-Za-z_]\w*)\b/);
      if (match) pushSymbol(lineNumber, "type", match[1]);
      match = line.match(/^fun\s+([A-Za-z_]\w*)\s*\(/);
      if (match) pushSymbol(lineNumber, "function", match[1]);
      if (/^fun\s+main\s*\(/.test(line)) {
        pushEntry(lineNumber, line);
      }
      continue;
    }

    if (language === "java") {
      if (/^(package|import)\s+/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/\b(class|interface|enum|record)\s+([A-Za-z_]\w*)\b/);
      if (match) pushSymbol(lineNumber, match[1], match[2]);
      match = line.match(/\b(?:public|private|protected|static|final|synchronized|native|\s)+[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
      if (match) pushSymbol(lineNumber, "method", match[1]);
      if (/public\s+static\s+void\s+main\s*\(/.test(line)) {
        pushEntry(lineNumber, line);
      }
      continue;
    }

    if (/^(c|cpp|c-header|cpp-header)$/.test(language)) {
      if (/^#\s*include\s+/.test(line)) {
        pushImport(lineNumber, line);
      }
      match = line.match(/\b(?:class|struct|enum)\s+([A-Za-z_]\w*)\b/);
      if (match) pushSymbol(lineNumber, "type", match[1]);
      match = line.match(/^(?:static\s+|inline\s+|extern\s+)?[\w:*&<>\s]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
      if (match) pushSymbol(lineNumber, "function", match[1]);
      if (/\bmain\s*\(/.test(line)) {
        pushEntry(lineNumber, line);
      }
    }
  }

  for (const item of symbols.slice(0, 120)) {
    records.push(`Code symbol ${item}`);
  }
  for (const item of entryPoints.slice(0, 20)) {
    records.push(`Code entry ${item}`);
  }
  for (const item of imports.slice(0, 60)) {
    records.push(`Code import ${item}`);
  }
  for (const item of todos.slice(0, 40)) {
    records.push(`Code todo ${item}`);
  }
  const excerpt = lines.slice(0, 80).join("\n").trim();
  if (excerpt) {
    records.push(`Code source excerpt lines 1-${Math.min(lines.length, 80)}:\n${excerpt}`);
  }

  return {
    text: records.join("\n"),
    language,
    lineCount: lines.length,
    importCount: imports.length,
    symbolCount: symbols.length,
    entryPointCount: entryPoints.length,
    todoCount: todos.length
  };
}

function parseUnifiedDiffText(text = "") {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const records = [];
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let additions = 0;
  let deletions = 0;
  let hunkCount = 0;

  const ensureFile = () => {
    if (!currentFile) {
      currentFile = {
        oldPath: "",
        newPath: "",
        hunks: 0,
        additions: 0,
        deletions: 0
      };
      files.push(currentFile);
    }
    return currentFile;
  };

  const completeFileLabel = (file) => file.newPath || file.oldPath || `file-${files.length}`;

  for (const rawLine of lines.slice(0, 50_000)) {
    const line = rawLine || "";
    let match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      currentFile = {
        oldPath: match[1],
        newPath: match[2],
        hunks: 0,
        additions: 0,
        deletions: 0
      };
      files.push(currentFile);
      currentHunk = null;
      records.push(`Diff file: ${completeFileLabel(currentFile)} from ${currentFile.oldPath}`);
      continue;
    }
    match = line.match(/^---\s+(?:a\/)?(.+)$/);
    if (match && !line.startsWith("--- /dev/null")) {
      ensureFile().oldPath = match[1];
      continue;
    }
    match = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (match && !line.startsWith("+++ /dev/null")) {
      const file = ensureFile();
      file.newPath = match[1];
      records.push(`Diff file: ${completeFileLabel(file)} from ${file.oldPath || "unknown"}`);
      continue;
    }
    match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@\s*(.*)$/);
    if (match) {
      const file = ensureFile();
      hunkCount += 1;
      file.hunks += 1;
      currentHunk = {
        oldStart: Number(match[1]),
        oldLines: Number(match[2] || 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] || 1),
        header: match[5] || ""
      };
      records.push(`Diff hunk ${completeFileLabel(file)} -${currentHunk.oldStart},${currentHunk.oldLines} +${currentHunk.newStart},${currentHunk.newLines}${currentHunk.header ? ` ${currentHunk.header}` : ""}`);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const file = ensureFile();
      additions += 1;
      file.additions += 1;
      if (file.additions <= 80) {
        records.push(`Diff added ${completeFileLabel(file)}: ${line.slice(1).trim().slice(0, 500)}`);
      }
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      const file = ensureFile();
      deletions += 1;
      file.deletions += 1;
      if (file.deletions <= 80) {
        records.push(`Diff removed ${completeFileLabel(file)}: ${line.slice(1).trim().slice(0, 500)}`);
      }
      continue;
    }
    if (currentHunk && line.startsWith(" ") && line.trim()) {
      const file = ensureFile();
      if (records.length < 1200) {
        records.push(`Diff context ${completeFileLabel(file)}: ${line.trim().slice(0, 300)}`);
      }
    }
  }

  if (!records.length) {
    const fallback = String(text || "").trim();
    if (fallback) {
      records.push(`Diff text: ${fallback.slice(0, 4000)}`);
    }
  }

  for (const file of files.slice(0, 80)) {
    records.unshift(`Diff summary ${completeFileLabel(file)}: ${file.hunks} hunks, +${file.additions}, -${file.deletions}`);
  }

  return {
    text: records.join("\n"),
    fileCount: files.length,
    hunkCount,
    additions,
    deletions
  };
}

function unfoldCalendarLines(text = "") {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function decodeCalendarValue(value = "") {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseCalendarDate(value = "") {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (match) {
    return isoDateFromParts(match[1], match[2], match[3]);
  }
  match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return isoDateFromParts(match[1], match[2], match[3]);
  }
  return "";
}

function parseCalendarText(text = "") {
  const records = [];
  const events = [];
  const todos = [];
  let current = null;
  let minDate = "";
  let maxDate = "";

  const updateRange = (date = "") => {
    if (!date) {
      return;
    }
    if (!minDate || date < minDate) {
      minDate = date;
    }
    if (!maxDate || date > maxDate) {
      maxDate = date;
    }
  };

  const closeComponent = () => {
    if (!current) {
      return;
    }
    const collection = current.type === "VTODO" ? todos : events;
    collection.push(current);
    current = null;
  };

  for (const rawLine of unfoldCalendarLines(text).slice(0, 20_000)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^BEGIN:(VEVENT|VTODO|VJOURNAL)$/i.test(line)) {
      current = {
        type: line.split(":")[1].toUpperCase(),
        fields: {}
      };
      continue;
    }
    if (/^END:(VEVENT|VTODO|VJOURNAL)$/i.test(line)) {
      closeComponent();
      continue;
    }
    if (!current) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const propertyPart = line.slice(0, colon);
    const value = decodeCalendarValue(line.slice(colon + 1));
    const [namePart] = propertyPart.split(";");
    const name = String(namePart || "").toUpperCase();
    if (!name) {
      continue;
    }
    current.fields[name] = value;
  }
  closeComponent();

  const emitComponent = (component, index, label) => {
    const fields = component.fields || {};
    const title = fields.SUMMARY || fields.UID || `${label} ${index + 1}`;
    records.push(`Calendar ${label} ${index + 1}: ${title}`);
    for (const [field, prefix] of [
      ["DTSTART", "start date"],
      ["DTEND", "end date"],
      ["DUE", "due date"],
      ["COMPLETED", "completed date"],
      ["CREATED", "created date"],
      ["LAST-MODIFIED", "modified date"]
    ]) {
      const date = parseCalendarDate(fields[field] || "");
      if (date) {
        updateRange(date);
        records.push(`Calendar ${label} ${prefix}: ${date}`);
      }
    }
    if (fields.LOCATION) {
      records.push(`Calendar ${label} location: ${fields.LOCATION}`);
    }
    if (fields.ORGANIZER) {
      records.push(`Calendar ${label} organizer: ${fields.ORGANIZER}`);
    }
    if (fields.DESCRIPTION) {
      records.push(`Calendar ${label} description: ${fields.DESCRIPTION.replace(/\s+/g, " ").slice(0, 1000)}`);
    }
  };

  events.forEach((event, index) => emitComponent(event, index, "event"));
  todos.forEach((todo, index) => emitComponent(todo, index, "todo"));

  if (!records.length) {
    const fallback = String(text || "").trim();
    if (fallback) {
      records.push(`Calendar text: ${fallback.slice(0, 4000)}`);
    }
  }

  return {
    text: records.join("\n"),
    eventCount: events.length,
    todoCount: todos.length,
    from: minDate,
    to: maxDate || minDate
  };
}

function secondsFromTranscriptTime(value = "") {
  const normalized = String(value || "").trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2) {
    return 0;
  }
  const seconds = Number(parts.pop() || 0);
  const minutes = Number(parts.pop() || 0);
  const hours = Number(parts.pop() || 0);
  return Math.max(0, Math.round(((hours * 3600) + (minutes * 60) + seconds) * 1000) / 1000);
}

function cleanTranscriptCueText(lines = []) {
  return lines
    .join(" ")
    .replace(/<c(?:\.[^>]*)?>/gi, "")
    .replace(/<\/c>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function speakerFromTranscriptCue(value = "") {
  const voice = String(value || "").match(/<v\s+([^>]+)>/i)?.[1] || "";
  if (voice) {
    return compactMarkupText(voice, 80);
  }
  const speaker = String(value || "").match(/^([A-Za-z][A-Za-z0-9 _.-]{1,60})\s*:\s+\S/)?.[1] || "";
  return speaker ? compactMarkupText(speaker, 80) : "";
}

function parseTranscriptText(text = "", metadata = {}) {
  const records = [];
  const elements = [];
  const cues = [];
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && cues.length < 5000) {
    let line = lines[index].trim();
    const lineNumber = index + 1;
    if (!line || /^WEBVTT(?:\s|$)/i.test(line) || /^NOTE(?:\s|$)/i.test(line) || /^STYLE$/i.test(line) || /^REGION$/i.test(line)) {
      index += 1;
      continue;
    }
    let cueId = "";
    if (/^\d+$/.test(line) && lines[index + 1]?.includes("-->")) {
      cueId = line;
      index += 1;
      line = lines[index].trim();
    } else if (!line.includes("-->") && lines[index + 1]?.includes("-->")) {
      cueId = line;
      index += 1;
      line = lines[index].trim();
    }
    const timing = line.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{3}|\d{1,2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3}|\d{1,2}:\d{2}[,.]\d{3})/);
    if (!timing) {
      index += 1;
      continue;
    }
    const start = timing[1].replace(",", ".");
    const end = timing[2].replace(",", ".");
    index += 1;
    const cueLines = [];
    while (index < lines.length && lines[index].trim()) {
      cueLines.push(lines[index]);
      index += 1;
    }
    const rawCue = cueLines.join(" ");
    const speaker = speakerFromTranscriptCue(rawCue);
    const cueText = cleanTranscriptCueText(cueLines);
    if (!cueText) {
      continue;
    }
    const cue = {
      cueId: cueId || `cue-${cues.length + 1}`,
      start,
      end,
      startSeconds: secondsFromTranscriptTime(start),
      endSeconds: secondsFromTranscriptTime(end),
      speaker,
      text: cueText,
      line: lineNumber
    };
    cues.push(cue);
    records.push(`Transcript cue ${cues.length} ${start} --> ${end}${speaker ? ` speaker ${speaker}` : ""}: ${cueText}`);
    pushStructureElement(elements, "transcript-cue", cueText, {
      line: lineNumber,
      transcript: {
        kind: "cue",
        cueId: cue.cueId,
        speaker,
        start,
        end,
        startSeconds: cue.startSeconds,
        endSeconds: cue.endSeconds
      }
    });
  }
  const speakers = uniqueOrdered(cues.map((cue) => cue.speaker).filter(Boolean));
  for (const speaker of speakers.slice(0, 200)) {
    const speakerText = cues
      .filter((cue) => cue.speaker === speaker)
      .map((cue) => cue.text)
      .join(" ")
      .slice(0, 1200);
    pushStructureElement(elements, "speaker-turn", speakerText, {
      name: speaker,
      transcript: { kind: "speaker-turn", speaker }
    });
  }
  const fallback = String(text || "").trim();
  return {
    text: records.join("\n") || fallback,
    elements,
    format: normalizeExtension(metadata.extension || "") === ".srt" ? "srt" : "webvtt",
    cueCount: cues.length,
    speakerCount: speakers.length,
    from: cues[0]?.start || "",
    to: cues[cues.length - 1]?.end || ""
  };
}

function xbrlFactLocalName(name = "") {
  return String(name || "").split(":").pop() || String(name || "");
}

function parseXbrlContexts(text = "") {
  const contexts = new Map();
  for (const match of String(text || "").matchAll(/<[^>]*:?context\b[^>]*\bid=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/[^>]*:?context>/gi)) {
    const id = decodeXmlEntities(match[2] || "");
    const body = match[3] || "";
    const start = body.match(/<[^>]*:?startDate\b[^>]*>([^<]+)<\/[^>]*:?startDate>/i)?.[1] || "";
    const end = body.match(/<[^>]*:?endDate\b[^>]*>([^<]+)<\/[^>]*:?endDate>/i)?.[1] || "";
    const instant = body.match(/<[^>]*:?instant\b[^>]*>([^<]+)<\/[^>]*:?instant>/i)?.[1] || "";
    contexts.set(id, {
      id,
      start: parseCalendarDate(start) || start.trim(),
      end: parseCalendarDate(end) || end.trim(),
      instant: parseCalendarDate(instant) || instant.trim()
    });
  }
  return contexts;
}

function parseXbrlText(text = "", metadata = {}) {
  const records = [];
  const elements = [];
  const contexts = parseXbrlContexts(text);
  const facts = [];
  const seen = new Set();
  const source = String(text || "");
  const factPatterns = [
    /<ix:(?:nonFraction|nonNumeric)\b([^>]*)>([\s\S]*?)<\/ix:(?:nonFraction|nonNumeric)>/gi,
    /<([A-Za-z][\w.-]*:[A-Za-z][\w.-]*)\b([^>]*)>([^<]{1,2000})<\/\1>/gi
  ];
  for (const pattern of factPatterns) {
    for (const match of source.matchAll(pattern)) {
      const inline = pattern.source.startsWith("<ix:");
      const attrs = inline ? match[1] || "" : match[2] || "";
      const name = inline
        ? xmlLocalAttribute(attrs, "name")
        : match[1] || "";
      const value = compactMarkupText(decodeXmlEntities(inline ? match[2] || "" : match[3] || "").replace(/<[^>]+>/g, " "), 500);
      const contextRef = xmlLocalAttribute(attrs, "contextRef");
      const unitRef = xmlLocalAttribute(attrs, "unitRef");
      const decimals = xmlLocalAttribute(attrs, "decimals");
      const localName = xbrlFactLocalName(name);
      if (!name || !value || /^(context|unit|schemaRef|startDate|endDate|instant|identifier|measure)$/i.test(localName)) {
        continue;
      }
      const dedupeKey = `${name}\n${contextRef}\n${unitRef}\n${value}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      const context = contexts.get(contextRef) || {};
      const fact = {
        name,
        localName,
        contextRef,
        unitRef,
        decimals,
        value,
        periodStart: context.start || "",
        periodEnd: context.end || "",
        instant: context.instant || ""
      };
      facts.push(fact);
      records.push(`XBRL fact ${localName}: ${value}${unitRef ? ` ${unitRef}` : ""}${contextRef ? ` context ${contextRef}` : ""}${fact.periodStart || fact.periodEnd ? ` period ${fact.periodStart || ""}..${fact.periodEnd || ""}` : ""}${fact.instant ? ` instant ${fact.instant}` : ""}`);
      pushStructureElement(elements, "xbrl-fact", `${localName}: ${value}`, {
        name: localName,
        xbrlFact: fact
      });
      if (facts.length >= 5000) {
        break;
      }
    }
  }
  const fallback = compactMarkupText(source.replace(/<[^>]+>/g, " "), 8000);
  return {
    text: records.join("\n") || fallback,
    elements,
    format: normalizeExtension(metadata.extension || "") === ".ixbrl" ? "ixbrl" : "xbrl",
    factCount: facts.length,
    contextCount: contexts.size,
    unitCount: new Set(facts.map((fact) => fact.unitRef).filter(Boolean)).size
  };
}

function parseDelimitedText(text = "", delimiter = ",") {
  const rows = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 1000)
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
  if (!rows.length) {
    return "";
  }
  const headers = rows[0];
  return rows
    .slice(1)
    .map((row, index) => {
      const cells = row.map((cell, cellIndex) => `${headers[cellIndex] || `Column ${cellIndex + 1}`}: ${cell}`);
      return `Row ${index + 1}: ${cells.join("; ")}`;
    })
    .join("\n") || rows.map((row) => row.join(" ")).join("\n");
}

function configPathForLine(line = "", sectionStack = []) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
    return null;
  }
  const yamlMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
  if (yamlMatch) {
    return {
      key: [...sectionStack, yamlMatch[1]].filter(Boolean).join("."),
      value: yamlMatch[2] || ""
    };
  }
  const keyValueMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
  if (keyValueMatch) {
    return {
      key: [...sectionStack, keyValueMatch[1]].filter(Boolean).join("."),
      value: keyValueMatch[2] || ""
    };
  }
  return null;
}

function parseConfigText(text = "", metadata = {}) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const sectionStack = [];
  const records = [];
  let section = "";
  let commentCount = 0;
  for (const rawLine of lines.slice(0, 5000)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) {
      commentCount += 1;
      continue;
    }
    const tomlOrIniSection = trimmed.match(/^\[([^\]]+)\]$/);
    if (tomlOrIniSection) {
      section = tomlOrIniSection[1].trim();
      sectionStack.splice(0, sectionStack.length, ...section.split(".").map((item) => item.trim()).filter(Boolean));
      records.push(`Section: ${section}`);
      continue;
    }
    const yamlSection = extension.match(/^\.ya?ml$/) && rawLine.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*$/);
    if (yamlSection) {
      const indentLevel = Math.floor((yamlSection[1] || "").length / 2);
      sectionStack.splice(indentLevel);
      sectionStack[indentLevel] = yamlSection[2];
      records.push(`Section: ${sectionStack.filter(Boolean).join(".")}`);
      continue;
    }
    const parsed = configPathForLine(rawLine, sectionStack);
    if (parsed) {
      const value = parsed.value.replace(/^["']|["']$/g, "");
      records.push(`Config ${parsed.key}: ${value}`);
    } else {
      records.push(`Config line: ${trimmed}`);
    }
  }
  return {
    text: records.join("\n"),
    keyValueCount: records.filter((line) => line.startsWith("Config ") && line.includes(":")).length,
    sectionCount: records.filter((line) => line.startsWith("Section:")).length,
    commentCount,
    format: extension || "config"
  };
}

function extractXmlAttributes(attributesText = "") {
  const attributes = {};
  for (const match of String(attributesText || "").matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = decodeXmlEntities(match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function cleanDiagramLabel(value = "") {
  return stripMarkup(decodeXmlEntities(String(value || "")))
    .replace(/\s+/g, " ")
    .trim();
}

function parseDiagramText(text = "", metadata = {}) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  const raw = String(text || "").replace(/\r\n/g, "\n");
  const records = [];
  const seen = new Set();
  let nodeCount = 0;
  let edgeCount = 0;
  let labelCount = 0;

  const pushRecord = (line) => {
    const normalized = String(line || "").replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    records.push(normalized);
  };

  const isXmlDiagram = extension === ".svg" || extension === ".drawio" || raw.includes("<svg") || raw.includes("<mxfile") || raw.includes("<mxGraphModel");
  if (isXmlDiagram) {
    for (const match of raw.matchAll(/<(title|desc|text|tspan)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const label = cleanDiagramLabel(match[2]);
      if (label) {
        labelCount += 1;
        pushRecord(`Diagram label: ${label}`);
      }
    }
    for (const match of raw.matchAll(/<(?:g|path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)>/gi)) {
      const attributes = extractXmlAttributes(match[1]);
      const label = cleanDiagramLabel(attributes["aria-label"] || attributes["inkscape:label"] || attributes["data-name"] || attributes.name || "");
      if (label) {
        labelCount += 1;
        pushRecord(`Diagram label: ${label}`);
      }
    }
    for (const match of raw.matchAll(/<diagram\b([^>]*)>/gi)) {
      const attributes = extractXmlAttributes(match[1]);
      if (attributes.name) {
        pushRecord(`Diagram page: ${attributes.name}`);
      }
    }
    for (const match of raw.matchAll(/<mxCell\b([^>]*)\/?>/gi)) {
      const attributes = extractXmlAttributes(match[1]);
      const id = attributes.id || `cell-${nodeCount + edgeCount + 1}`;
      const label = cleanDiagramLabel(attributes.value || attributes.label || "");
      if (attributes.source || attributes.target || attributes.edge === "1") {
        edgeCount += 1;
        pushRecord(`Diagram edge ${id}: ${attributes.source || "unknown"} -> ${attributes.target || "unknown"}${label ? ` label ${label}` : ""}`);
      } else if (label) {
        nodeCount += 1;
        pushRecord(`Diagram node ${id}: ${label}`);
      }
    }
  }

  const lineLimit = 1000;
  for (const rawLine of raw.split("\n").slice(0, lineLimit)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%") || line.startsWith("//") || line.startsWith("'")) {
      continue;
    }
    if (/^(@startuml|@enduml|graph\s|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|mindmap)/i.test(line)) {
      pushRecord(`Diagram directive: ${line}`);
      continue;
    }
    const edgeMatch = line.match(/^(.+?)\s*(-->|---|->|=>|==>|-\.-?>|\.\.>|--)\s*(.+)$/);
    if (edgeMatch) {
      edgeCount += 1;
      pushRecord(`Diagram edge: ${cleanDiagramLabel(edgeMatch[1])} -> ${cleanDiagramLabel(edgeMatch[3])}`);
      continue;
    }
    if (extension === ".mmd" || extension === ".mermaid" || extension === ".puml" || extension === ".plantuml") {
      labelCount += 1;
      pushRecord(`Diagram line: ${line}`);
    }
  }

  if (!records.length) {
    const fallback = stripMarkup(raw);
    if (fallback) {
      pushRecord(`Diagram text: ${fallback.slice(0, 4000)}`);
    }
  }

  return {
    text: records.join("\n"),
    nodeCount,
    edgeCount,
    labelCount,
    format: extension || "diagram"
  };
}

function unfoldHeaderLines(headersText = "") {
  const lines = String(headersText || "").replace(/\r\n/g, "\n").split("\n");
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseEmailHeaders(headersText = "") {
  const headers = {};
  for (const line of unfoldHeaderLines(headersText)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      headers[match[1].toLowerCase()] = match[2];
    }
  }
  return headers;
}

function parseHeaderParams(value = "") {
  const [type = "", ...paramParts] = String(value || "").split(";");
  const params = {};
  for (const part of paramParts) {
    const match = part.trim().match(/^([^=]+)=("?)(.*?)\2$/);
    if (match) {
      params[match[1].trim().toLowerCase()] = match[3].trim();
    }
  }
  return {
    value: type.trim().toLowerCase(),
    params
  };
}

function decodeQuotedPrintable(value = "") {
  return String(value || "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeMimeBody(body = "", encoding = "") {
  const normalizedEncoding = String(encoding || "").trim().toLowerCase();
  if (normalizedEncoding === "base64") {
    return Buffer.from(String(body || "").replace(/\s+/g, ""), "base64");
  }
  if (normalizedEncoding === "quoted-printable") {
    return Buffer.from(decodeQuotedPrintable(body), "utf8");
  }
  return Buffer.from(String(body || ""), "utf8");
}

function splitMimeParts(body = "", boundary = "") {
  if (!boundary) {
    return [];
  }
  const marker = `--${boundary}`;
  const parts = [];
  const segments = String(body || "").replace(/\r\n/g, "\n").split(marker);
  for (const segment of segments) {
    const trimmed = segment.replace(/^\n/, "");
    if (!trimmed || trimmed.startsWith("--")) {
      continue;
    }
    parts.push(trimmed.replace(/\n--$/, "").trimEnd());
  }
  return parts;
}

function parseMimeMessage(text = "", depth = 0) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const separatorIndex = normalized.indexOf("\n\n");
  const headersText = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : "";
  const bodyText = separatorIndex >= 0 ? normalized.slice(separatorIndex + 2) : normalized;
  const headers = parseEmailHeaders(headersText);
  const contentType = parseHeaderParams(headers["content-type"] || "text/plain");
  const disposition = parseHeaderParams(headers["content-disposition"] || "");
  const transferEncoding = headers["content-transfer-encoding"] || "";
  const fileName = disposition.params.filename || contentType.params.name || "";
  const isMultipart = contentType.value.startsWith("multipart/");
  const textParts = [];
  const attachments = [];

  if (isMultipart && depth < EMAIL_MIME_MAX_DEPTH) {
    for (const part of splitMimeParts(bodyText, contentType.params.boundary || "")) {
      const parsed = parseMimeMessage(part, depth + 1);
      textParts.push(...parsed.textParts);
      attachments.push(...parsed.attachments);
    }
  } else {
    const bodyBuffer = decodeMimeBody(bodyText, transferEncoding);
    const bodyString = bodyBuffer.toString("utf8").trim();
    const isAttachment = Boolean(fileName || disposition.value === "attachment");
    if (isAttachment) {
      attachments.push({
        fileName: fileName || "attachment.bin",
        mediaType: contentType.value || inferMediaTypeFromExtension(path.extname(fileName || "")) || "application/octet-stream",
        data: bodyBuffer,
        headers
      });
    } else if (contentType.value === "text/html") {
      textParts.push(stripMarkup(bodyString));
    } else if (!contentType.value || contentType.value.startsWith("text/")) {
      textParts.push(bodyString);
    }
  }
  return { headers, textParts, attachments };
}

function parseEmailText(text = "") {
  const parsed = parseMimeMessage(text);
  const headers = parsed.headers || {};
  const body = parsed.textParts.filter(Boolean).join("\n\n").trim();
  return [
    headers.from ? `From: ${headers.from}` : "",
    headers.to ? `To: ${headers.to}` : "",
    headers.date ? `Date: ${headers.date}` : "",
    headers.subject ? `Subject: ${headers.subject}` : "",
    body
  ].filter(Boolean).join("\n");
}

function splitMboxMessages(text = "", maxMessages = EMAIL_MBOX_MAX_MESSAGES, maxMessageCharacters = EMAIL_MBOX_MESSAGE_MAX_CHARACTERS) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const messages = [];
  let currentEnvelope = "";
  let currentLines = [];
  let currentCharacters = 0;
  let currentTruncated = false;
  const flush = () => {
    const raw = currentLines.join("\n").trim();
    if (raw) {
      messages.push({
        index: messages.length + 1,
        envelope: currentEnvelope,
        text: raw,
        truncated: currentTruncated
      });
    }
    currentEnvelope = "";
    currentLines = [];
    currentCharacters = 0;
    currentTruncated = false;
  };
  const appendLine = (line = "") => {
    const lineWithBreak = `${line}\n`;
    if (currentCharacters < maxMessageCharacters) {
      const remaining = maxMessageCharacters - currentCharacters;
      currentLines.push(lineWithBreak.slice(0, remaining).replace(/\n$/, ""));
      if (lineWithBreak.length > remaining) {
        currentTruncated = true;
      }
    } else {
      currentTruncated = true;
    }
    currentCharacters += lineWithBreak.length;
  };
  for (const line of lines) {
    if (line.startsWith("From ") && (currentEnvelope || currentLines.length)) {
      flush();
      if (messages.length >= maxMessages) {
        break;
      }
      currentEnvelope = line;
      continue;
    }
    if (line.startsWith("From ") && !currentEnvelope && currentLines.length === 0) {
      currentEnvelope = line;
      continue;
    }
    appendLine(line);
  }
  if (messages.length < maxMessages) {
    flush();
  }
  if (!messages.length && String(text || "").trim()) {
    messages.push({
      index: 1,
      envelope: "",
      text: String(text || "").trim()
    });
  }
  return messages;
}

function readMboxMessagesFromFile(filePath = "", maxMessages = EMAIL_MBOX_MAX_MESSAGES) {
  const messages = [];
  const hash = crypto.createHash("sha256");
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  let file = null;
  let pending = "";
  let currentEnvelope = "";
  let currentLines = [];
  let currentCharacters = 0;
  let currentTruncated = false;
  let totalCharacters = 0;
  const flush = () => {
    const raw = currentLines.join("\n").trim();
    if (raw && messages.length < maxMessages) {
      messages.push({
        index: messages.length + 1,
        envelope: currentEnvelope,
        text: raw,
        truncated: currentTruncated
      });
    }
    currentEnvelope = "";
    currentLines = [];
    currentCharacters = 0;
    currentTruncated = false;
  };
  const appendLine = (line = "") => {
    const lineWithBreak = `${line}\n`;
    totalCharacters += lineWithBreak.length;
    if (currentCharacters < EMAIL_MBOX_MESSAGE_MAX_CHARACTERS) {
      const remaining = EMAIL_MBOX_MESSAGE_MAX_CHARACTERS - currentCharacters;
      currentLines.push(lineWithBreak.slice(0, remaining).replace(/\n$/, ""));
      if (lineWithBreak.length > remaining) {
        currentTruncated = true;
      }
    } else {
      currentTruncated = true;
    }
    currentCharacters += lineWithBreak.length;
  };
  const processLine = (line = "") => {
    const cleanLine = line.replace(/\r$/, "");
    if (cleanLine.startsWith("From ") && (currentEnvelope || currentLines.length)) {
      flush();
      currentEnvelope = cleanLine;
      return;
    }
    if (cleanLine.startsWith("From ") && !currentEnvelope && currentLines.length === 0) {
      currentEnvelope = cleanLine;
      return;
    }
    appendLine(cleanLine);
  };
  try {
    file = fsSync.openSync(filePath, "r");
    while (messages.length < maxMessages) {
      const bytesRead = fsSync.readSync(file, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      pending += decoder.decode(bytes, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
        if (messages.length >= maxMessages) {
          break;
        }
      }
    }
    const tail = decoder.decode();
    if (tail) {
      pending += tail;
    }
    if (messages.length < maxMessages && pending) {
      processLine(pending);
    }
    if (messages.length < maxMessages) {
      flush();
    }
  } finally {
    if (file !== null) {
      fsSync.closeSync(file);
    }
  }
  return {
    messages,
    totalCharacters,
    contentHash: `sha256:${hash.digest("hex")}`,
    truncated: messages.length >= maxMessages
  };
}

function mboxMessageSummary(message = {}) {
  const parsed = parseMimeMessage(message.text || "");
  const headers = parsed.headers || {};
  const subject = headers.subject || `Message ${message.index}`;
  const body = parsed.textParts.filter(Boolean).join(" ").trim();
  return {
    index: message.index,
    envelope: message.envelope || "",
    subject,
    from: headers.from || "",
    to: headers.to || "",
    date: headers.date || "",
    attachmentCount: parsed.attachments?.length || 0,
    excerpt: firstSentence(body || subject)
  };
}

function parseMboxText(text = "") {
  const messages = splitMboxMessages(text);
  const summaries = messages.map(mboxMessageSummary);
  const lines = [
    `MBOX messages: ${summaries.length}`,
    ...summaries.map((summary) => [
      `Message ${summary.index}: ${summary.subject}`,
      summary.from ? `From: ${summary.from}` : "",
      summary.to ? `To: ${summary.to}` : "",
      summary.date ? `Date: ${summary.date}` : "",
      `Attachments: ${summary.attachmentCount}`,
      summary.excerpt
    ].filter(Boolean).join("\n"))
  ];
  return {
    text: lines.filter(Boolean).join("\n\n"),
    messages,
    summaries
  };
}

function readZipEntries(buffer) {
  const data = Buffer.from(buffer || []);
  const entries = [];
  let offset = 0;
  while (offset + 30 <= data.length) {
    const signature = data.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = data.readUInt16LE(offset + 6);
    const method = data.readUInt16LE(offset + 8);
    const compressedSize = data.readUInt32LE(offset + 18);
    const uncompressedSize = data.readUInt32LE(offset + 22);
    const fileNameLength = data.readUInt16LE(offset + 26);
    const extraLength = data.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const contentStart = nameEnd + extraLength;
    if (nameEnd > data.length || contentStart > data.length) {
      break;
    }
    const name = data.slice(nameStart, nameEnd).toString("utf8");
    const hasDataDescriptor = Boolean(flags & 0x08);
    if (hasDataDescriptor || compressedSize > data.length - contentStart) {
      entries.push({ name, method, compressedSize, uncompressedSize, data: Buffer.alloc(0), warning: "zip-data-descriptor-not-supported" });
      offset = contentStart + Math.max(0, compressedSize);
      continue;
    }
    const compressed = data.slice(contentStart, contentStart + compressedSize);
    let entryData = Buffer.alloc(0);
    let warning = "";
    try {
      if (method === 0) {
        entryData = compressed;
      } else if (method === 8) {
        entryData = Buffer.from(inflateRawSync(compressed));
      } else {
        warning = `zip-method-${method}-not-supported`;
      }
    } catch (error) {
      warning = `zip-inflate-failed:${error instanceof Error ? error.message : String(error)}`;
    }
    entries.push({ name, method, compressedSize, uncompressedSize, data: entryData, warning });
    offset = contentStart + compressedSize;
  }
  return entries;
}

function parseTarSize(buffer, offset, length) {
  const raw = buffer.slice(offset, offset + length).toString("ascii").replace(/\0.*$/, "").trim();
  if (!raw) {
    return 0;
  }
  const parsed = parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tarEntryName(header) {
  const name = header.slice(0, 100).toString("utf8").replace(/\0.*$/, "").trim();
  const prefix = header.slice(345, 500).toString("utf8").replace(/\0.*$/, "").trim();
  return [prefix, name].filter(Boolean).join("/");
}

function readTarEntries(buffer) {
  const data = Buffer.from(buffer || []);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.slice(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = tarEntryName(header);
    const size = parseTarSize(header, 124, 12);
    const typeFlag = header.slice(156, 157).toString("ascii") || "0";
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (!name || dataEnd > data.length) {
      break;
    }
    if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      entries.push({
        name,
        method: "tar",
        compressedSize: size,
        uncompressedSize: size,
        data: data.slice(dataStart, dataEnd),
        warning: ""
      });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function looksLikeTar(buffer) {
  const data = Buffer.from(buffer || []);
  return data.length >= 512 && data.slice(257, 262).toString("ascii") === "ustar";
}

function stripGzipExtension(fileName = "") {
  const text = String(fileName || "").trim();
  if (/\.tar\.gz$/i.test(text)) {
    return text.replace(/\.tar\.gz$/i, ".tar");
  }
  if (/\.tgz$/i.test(text)) {
    return text.replace(/\.tgz$/i, ".tar");
  }
  if (/\.gz$/i.test(text)) {
    return text.replace(/\.gz$/i, "");
  }
  return text ? `${text}.inflated` : "payload.inflated";
}

function archiveKind(metadata = {}, buffer = null) {
  const extension = normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""));
  const fileName = String(metadata.fileName || "").toLowerCase();
  const mediaType = String(metadata.mediaType || "").toLowerCase();
  const data = Buffer.from(buffer || []);
  if (extension === ".7z" || mediaType.includes("7z")) {
    return "7z";
  }
  if (
    extension === ".zip" ||
    mediaType === "application/zip" ||
    mediaType === "application/x-zip-compressed" ||
    data.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    return "zip";
  }
  if (extension === ".tar" || mediaType.includes("x-tar") || mediaType.includes("x-gtar") || looksLikeTar(data)) {
    return "tar";
  }
  if (
    extension === ".gz" ||
    extension === ".tgz" ||
    extension === ".tar.gz" ||
    fileName.endsWith(".tar.gz") ||
    mediaType.includes("gzip") ||
    (data[0] === 0x1f && data[1] === 0x8b)
  ) {
    return "gzip";
  }
  return "unknown";
}

function safeRelativeArchivePath(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function readDirectoryEntries(rootDir, limit = ARCHIVE_EXPANSION_MAX_ENTRIES) {
  const entries = [];
  const walk = (dir, relativeBase = "") => {
    if (entries.length >= limit) {
      return;
    }
    for (const item of fsSync.readdirSync(dir, { withFileTypes: true })) {
      if (entries.length >= limit) {
        return;
      }
      const absolutePath = path.join(dir, item.name);
      const relativePath = safeRelativeArchivePath(path.join(relativeBase, item.name));
      if (!relativePath) {
        continue;
      }
      if (item.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }
      if (!item.isFile()) {
        continue;
      }
      const stat = fsSync.statSync(absolutePath);
      if (stat.size > ARCHIVE_ENTRY_MAX_BYTES) {
        entries.push({
          name: relativePath,
          method: "7z-external",
          compressedSize: stat.size,
          uncompressedSize: stat.size,
          data: Buffer.alloc(0),
          warning: "archive-entry-too-large"
        });
        continue;
      }
      entries.push({
        name: relativePath,
        method: "7z-external",
        compressedSize: stat.size,
        uncompressedSize: stat.size,
        data: fsSync.readFileSync(absolutePath),
        warning: ""
      });
    }
  };
  walk(rootDir);
  return entries;
}

function readDirectoryFileRefs(rootDir, limit = ARCHIVE_EXPANSION_MAX_ENTRIES) {
  const entries = [];
  const walk = (dir, relativeBase = "") => {
    if (entries.length >= limit) {
      return;
    }
    for (const item of fsSync.readdirSync(dir, { withFileTypes: true })) {
      if (entries.length >= limit) {
        return;
      }
      const absolutePath = path.join(dir, item.name);
      const relativePath = safeRelativeArchivePath(path.join(relativeBase, item.name));
      if (!relativePath) {
        continue;
      }
      if (item.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }
      if (!item.isFile()) {
        continue;
      }
      const stat = fsSync.statSync(absolutePath);
      entries.push({
        name: relativePath,
        method: "archive-file-ref",
        compressedSize: stat.size,
        uncompressedSize: stat.size,
        data: Buffer.alloc(0),
        filePath: absolutePath,
        warning: ""
      });
    }
  };
  walk(rootDir);
  return entries;
}

function readSevenZipEntries(buffer, metadata = {}, runtimeStatus = null) {
  const runtime = runtimeStatus?.runtimes?.["archive.7zip"];
  if (!runtime?.available) {
    return {
      entries: [],
      parserTrace: [runtimeStageTrace("archive.7z.extract", runtimeStatus, "archive.7zip")],
      warnings: ["missing-runtime:archive.7zip"]
    };
  }
  const workDir = tempWorkDir("external-kd-7z-");
  const archivePath = path.join(workDir, `source${safeExtension(metadata.extension || ".7z")}`);
  const outputDir = path.join(workDir, "out");
  try {
    fsSync.mkdirSync(outputDir, { recursive: true });
    fsSync.writeFileSync(archivePath, Buffer.from(buffer || []));
    execFileSync(runtime.command || "7zz", ["x", "-y", `-o${outputDir}`, archivePath], {
      encoding: "utf8",
      timeout: ARCHIVE_EXTERNAL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    });
    const entries = readDirectoryEntries(outputDir);
    return {
      entries,
      parserTrace: [{
        stage: "archive.7z.extract",
        status: entries.length ? "completed" : "empty",
        runtime: "archive.7zip",
        command: runtime.command || "7zz",
        entries: entries.length
      }],
      warnings: entries.some((entry) => entry.warning) ? ["archive-entry-warning"] : []
    };
  } catch (error) {
    return {
      entries: [],
      parserTrace: [{
        stage: "archive.7z.extract",
        status: "failed",
        runtime: "archive.7zip",
        command: runtime.command || "7zz",
        error: error instanceof Error ? error.message : String(error)
      }],
      warnings: ["archive-7z-extract-failed"]
    };
  } finally {
    fsSync.rmSync(workDir, { recursive: true, force: true });
  }
}

function requireRuntime(runtimeStatus = null, key = "") {
  const runtime = runtimeStatus?.runtimes?.[key];
  return runtime?.available ? runtime : null;
}

function runArchiveCommand(command, args = [], stage = "archive.file-ref.extract") {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    timeout: ARCHIVE_EXTERNAL_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024
  });
  return String(output || "");
}

function gunzipFileToPath({ gzipCommand = "gzip", inputPath = "", outputPath = "" } = {}) {
  const outputFd = fsSync.openSync(outputPath, "w");
  try {
    const result = spawnSync(gzipCommand, ["-dc", inputPath], {
      stdio: ["ignore", outputFd, "pipe"],
      timeout: ARCHIVE_EXTERNAL_TIMEOUT_MS,
      encoding: "utf8"
    });
    if (result.status !== 0) {
      throw new Error(String(result.stderr || `gzip exited with ${result.status}`));
    }
  } finally {
    fsSync.closeSync(outputFd);
  }
}

function extractArchiveFileEntries(filePath = "", metadata = {}, runtimeStatus = null, remainingEntries = ARCHIVE_EXPANSION_MAX_ENTRIES) {
  const kind = archiveKind(metadata, null);
  const workDir = tempWorkDir("external-kd-archive-file-");
  const outputDir = path.join(workDir, "out");
  fsSync.mkdirSync(outputDir, { recursive: true });
  const parserTrace = [{ stage: "archive.container-detect", status: "completed", kind, mode: "file-ref" }];
  const warnings = [];
  try {
    if (kind === "zip") {
      const sevenZip = requireRuntime(runtimeStatus, "archive.7zip");
      const unzip = requireRuntime(runtimeStatus, "archive.unzip");
      if (sevenZip) {
        runArchiveCommand(sevenZip.command || "7zz", ["x", "-y", `-o${outputDir}`, filePath], "archive.zip.extract");
        parserTrace.push({ stage: "archive.zip.extract", status: "completed", runtime: "archive.7zip", command: sevenZip.command || "7zz" });
      } else if (unzip) {
        runArchiveCommand(unzip.command || "unzip", ["-qq", filePath, "-d", outputDir], "archive.zip.extract");
        parserTrace.push({ stage: "archive.zip.extract", status: "completed", runtime: "archive.unzip", command: unzip.command || "unzip" });
      } else {
        parserTrace.push(runtimeStageTrace("archive.zip.extract", runtimeStatus, "archive.unzip"));
        warnings.push("missing-runtime:archive.unzip");
      }
    } else if (kind === "tar") {
      const tar = requireRuntime(runtimeStatus, "archive.tar");
      if (!tar) {
        parserTrace.push(runtimeStageTrace("archive.tar.extract", runtimeStatus, "archive.tar"));
        warnings.push("missing-runtime:archive.tar");
      } else {
        runArchiveCommand(tar.command || "tar", ["-xf", filePath, "-C", outputDir], "archive.tar.extract");
        parserTrace.push({ stage: "archive.tar.extract", status: "completed", runtime: "archive.tar", command: tar.command || "tar" });
      }
    } else if (kind === "gzip") {
      const tar = requireRuntime(runtimeStatus, "archive.tar");
      const gzip = requireRuntime(runtimeStatus, "archive.gzip");
      const isTarGzip = metadata.extension === ".tgz" || metadata.extension === ".tar.gz" || /\.t(ar\.)?gz$/i.test(metadata.fileName || "");
      if (isTarGzip) {
        if (!tar) {
          parserTrace.push(runtimeStageTrace("archive.tar.extract", runtimeStatus, "archive.tar"));
          warnings.push("missing-runtime:archive.tar");
        } else {
          runArchiveCommand(tar.command || "tar", ["-xzf", filePath, "-C", outputDir], "archive.gzip-tar.extract");
          parserTrace.push({ stage: "archive.gzip.decompress", status: "completed", runtime: "archive.tar", command: tar.command || "tar" });
          parserTrace.push({ stage: "archive.tar.extract", status: "completed", runtime: "archive.tar", command: tar.command || "tar" });
        }
      } else if (!gzip) {
        parserTrace.push(runtimeStageTrace("archive.gzip.decompress", runtimeStatus, "archive.gzip"));
        warnings.push("missing-runtime:archive.gzip");
      } else {
        const outputName = safeRelativeArchivePath(stripGzipExtension(metadata.fileName || "payload.gz")) || "payload.inflated";
        const outputPath = path.join(outputDir, outputName);
        fsSync.mkdirSync(path.dirname(outputPath), { recursive: true });
        gunzipFileToPath({ gzipCommand: gzip.command || "gzip", inputPath: filePath, outputPath });
        parserTrace.push({ stage: "archive.gzip.decompress", status: "completed", runtime: "archive.gzip", command: gzip.command || "gzip" });
      }
    } else if (kind === "7z") {
      const sevenZip = requireRuntime(runtimeStatus, "archive.7zip");
      if (!sevenZip) {
        parserTrace.push(runtimeStageTrace("archive.7z.extract", runtimeStatus, "archive.7zip"));
        warnings.push("missing-runtime:archive.7zip");
      } else {
        runArchiveCommand(sevenZip.command || "7zz", ["x", "-y", `-o${outputDir}`, filePath], "archive.7z.extract");
        parserTrace.push({ stage: "archive.7z.extract", status: "completed", runtime: "archive.7zip", command: sevenZip.command || "7zz" });
      }
    } else {
      parserTrace.push({ stage: "archive.file-ref.extract", status: "unsupported", kind });
      warnings.push("archive-container-unsupported");
    }
    const entries = readDirectoryFileRefs(outputDir, remainingEntries);
    parserTrace.push({
      stage: "archive.file-ref.entries",
      status: entries.length ? "completed" : "empty",
      entries: entries.length,
      maxEntries: remainingEntries
    });
    return {
      entries,
      parserTrace,
      warnings,
      cleanup: () => fsSync.rmSync(workDir, { recursive: true, force: true })
    };
  } catch (error) {
    parserTrace.push({
      stage: "archive.file-ref.extract",
      status: "failed",
      kind,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      entries: [],
      parserTrace,
      warnings: [...warnings, "archive-file-ref-extract-failed"],
      cleanup: () => fsSync.rmSync(workDir, { recursive: true, force: true })
    };
  }
}

function extractZipFileToDirectory(filePath = "", runtimeStatus = null, stage = "zip.file-ref.extract") {
  const workDir = tempWorkDir("external-kd-zip-file-");
  const outputDir = path.join(workDir, "out");
  fsSync.mkdirSync(outputDir, { recursive: true });
  const parserTrace = [];
  const warnings = [];
  try {
    const sevenZip = requireRuntime(runtimeStatus, "archive.7zip");
    const unzip = requireRuntime(runtimeStatus, "archive.unzip");
    if (sevenZip) {
      runArchiveCommand(sevenZip.command || "7zz", ["x", "-y", `-o${outputDir}`, filePath], stage);
      parserTrace.push({ stage, status: "completed", runtime: "archive.7zip", command: sevenZip.command || "7zz" });
    } else if (unzip) {
      runArchiveCommand(unzip.command || "unzip", ["-qq", filePath, "-d", outputDir], stage);
      parserTrace.push({ stage, status: "completed", runtime: "archive.unzip", command: unzip.command || "unzip" });
    } else {
      parserTrace.push(runtimeStageTrace(stage, runtimeStatus, "archive.unzip"));
      warnings.push("missing-runtime:archive.unzip");
    }
    return {
      outputDir,
      parserTrace,
      warnings,
      cleanup: () => fsSync.rmSync(workDir, { recursive: true, force: true })
    };
  } catch (error) {
    parserTrace.push({
      stage,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      outputDir,
      parserTrace,
      warnings: [...warnings, "zip-file-ref-extract-failed"],
      cleanup: () => fsSync.rmSync(workDir, { recursive: true, force: true })
    };
  }
}

function extractArchiveEntries(buffer, metadata = {}, runtimeStatus = null) {
  const kind = archiveKind(metadata, buffer);
  const parserTrace = [{ stage: "archive.container-detect", status: "completed", kind }];
  const warnings = [];
  try {
    if (kind === "zip") {
      const entries = readZipEntries(buffer);
      parserTrace.push({ stage: "archive.zip.container", status: entries.length ? "completed" : "empty", entries: entries.length });
      return { entries, parserTrace, warnings };
    }
    if (kind === "tar") {
      const entries = readTarEntries(buffer);
      parserTrace.push({ stage: "archive.tar.container", status: entries.length ? "completed" : "empty", entries: entries.length });
      return { entries, parserTrace, warnings };
    }
    if (kind === "gzip") {
      const inflated = Buffer.from(gunzipSync(Buffer.from(buffer || [])));
      parserTrace.push({ stage: "archive.gzip.decompress", status: "completed", bytes: inflated.length });
      if (looksLikeTar(inflated) || metadata.extension === ".tgz" || metadata.extension === ".tar.gz" || /\.t(ar\.)?gz$/i.test(metadata.fileName || "")) {
        const entries = readTarEntries(inflated);
        parserTrace.push({ stage: "archive.tar.container", status: entries.length ? "completed" : "empty", entries: entries.length });
        return { entries, parserTrace, warnings };
      }
      const name = stripGzipExtension(metadata.fileName || "payload.gz");
      return {
        entries: [{
          name,
          method: "gzip",
          compressedSize: Buffer.byteLength(buffer || []),
          uncompressedSize: inflated.length,
          data: inflated,
          warning: ""
        }],
        parserTrace: [...parserTrace, { stage: "archive.gzip.single-file", status: "completed", entries: 1 }],
        warnings
      };
    }
    if (kind === "7z") {
      const extracted = readSevenZipEntries(buffer, metadata, runtimeStatus);
      return {
        entries: extracted.entries,
        parserTrace: [...parserTrace, ...extracted.parserTrace],
        warnings: [...warnings, ...extracted.warnings]
      };
    }
    parserTrace.push({ stage: "archive.container", status: "unsupported" });
    return { entries: [], parserTrace, warnings: ["archive-container-unsupported"] };
  } catch (error) {
    parserTrace.push({
      stage: `archive.${kind}.container`,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    return { entries: [], parserTrace, warnings: [`archive-${kind}-failed`] };
  }
}

function zipEntryText(entries = [], entryName = "") {
  const entry = entries.find((item) => item.name === entryName);
  return entry?.data?.length ? utf8(entry.data) : "";
}

function structureElementsToText(format = "document", elements = [], fallback = "") {
  if (!elements.length && !String(fallback || "").trim()) {
    return "";
  }
  const records = elements.length ? [`Document format: ${format}`] : [];
  for (const element of elements.slice(0, 900)) {
    const level = element.level ? ` level ${element.level}` : "";
    const line = element.line ? ` line ${element.line}` : "";
    const name = element.name ? ` ${element.name}` : "";
    const href = element.href ? ` -> ${element.href}` : "";
    const shapeName = element.shape?.name ? ` shape ${element.shape.name}` : "";
    const placeholder = element.shape?.placeholderType
      ? ` placeholder ${element.shape.placeholderType}`
      : element.shape?.isPlaceholder
        ? " placeholder"
        : "";
    records.push(`Document ${element.type}${level}${name}${line}${shapeName}${placeholder}: ${element.text}${href}`);
  }
  if (records.length === 1 && fallback) {
    records.push(`Document text: ${compactMarkupText(fallback, 6000)}`);
  }
  return records.filter(Boolean).join("\n");
}

function docxParagraphStyle(paragraphXml = "") {
  const styleTag = String(paragraphXml || "").match(/<[^:>]*:?pStyle\b[^>]*>/i)?.[0] || "";
  return xmlLocalAttribute(styleTag, "val");
}

function docxHeaderFooterMetadata(partName = "") {
  const match = String(partName || "").match(/^word\/(header|footer)(\d*)\.xml$/i);
  if (!match) {
    return null;
  }
  const kind = match[1].toLowerCase();
  const partIndex = Number(match[2] || 0);
  return {
    kind,
    partName,
    partIndex,
    label: `${kind === "header" ? "Header" : "Footer"}${partIndex ? ` ${partIndex}` : ""}`
  };
}

function docxPartSortKey(partName = "") {
  if (partName === "word/document.xml") {
    return 0;
  }
  const headerFooter = docxHeaderFooterMetadata(partName);
  if (!headerFooter) {
    return 1000;
  }
  return headerFooter.kind === "header"
    ? 100 + headerFooter.partIndex
    : 200 + headerFooter.partIndex;
}

function docxParagraphStyleProfile(paragraphXml = "", styleId = "") {
  const numPr = String(paragraphXml || "").match(/<[^:>]*:?numPr\b[\s\S]*?<\/[^:>]*:?numPr>/i)?.[0] || "";
  const numberingId = xmlLocalAttribute(numPr.match(/<[^:>]*:?numId\b[^>]*>/i)?.[0] || "", "val");
  const numberingLevel = xmlLocalAttribute(numPr.match(/<[^:>]*:?ilvl\b[^>]*>/i)?.[0] || "", "val");
  const listLevel = numberingLevel === "" ? 0 : Math.max(1, (Number(numberingLevel) || 0) + 1);
  return {
    ...(styleId ? { styleId } : {}),
    ...(numberingId ? { numberingId } : {}),
    ...(numberingLevel !== "" ? { numberingLevel: Number(numberingLevel) || 0 } : {}),
    ...(listLevel ? { listLevel } : {})
  };
}

function docxParagraphElementType(paragraphXml = "", style = "") {
  if (/^Title$/i.test(style)) {
    return { type: "title", level: 1 };
  }
  const heading = String(style || "").match(/^Heading\s*(\d+)$/i);
  if (heading) {
    return { type: "heading", level: Math.max(1, Math.min(8, Number(heading[1]) || 1)) };
  }
  const styleProfile = docxParagraphStyleProfile(paragraphXml, style);
  if (/^ListParagraph$/i.test(style) || styleProfile.numberingId) {
    return { type: "list-item", level: styleProfile.listLevel || 1 };
  }
  if (/<[^:>]*:?numPr\b/i.test(paragraphXml)) {
    return { type: "list-item", level: styleProfile.listLevel || 1 };
  }
  return { type: "paragraph", level: 0 };
}

function docxContentControlType(prXml = "") {
  for (const type of ["checkbox", "dropDownList", "comboBox", "date", "picture", "richText", "text", "repeatingSection", "docPartObj"]) {
    if (new RegExp(`<[^:>]*:?${type}\\b`, "i").test(prXml)) {
      return type;
    }
  }
  return "unknown";
}

function docxContentControlProperties(sdtXml = "", sourcePart = "", fallbackIndex = 0) {
  const prXml = String(sdtXml || "").match(/<[^:>]*:?sdtPr\b[\s\S]*?<\/[^:>]*:?sdtPr>/i)?.[0] || "";
  return {
    kind: "word-content-control",
    id: xmlLocalAttribute(prXml.match(/<[^:>]*:?id\b[^>]*(?:\/>|>)/i)?.[0] || "", "val") || String(fallbackIndex || ""),
    alias: xmlLocalAttribute(prXml.match(/<[^:>]*:?alias\b[^>]*(?:\/>|>)/i)?.[0] || "", "val"),
    tag: xmlLocalAttribute(prXml.match(/<[^:>]*:?tag\b[^>]*(?:\/>|>)/i)?.[0] || "", "val"),
    controlType: docxContentControlType(prXml),
    lock: xmlLocalAttribute(prXml.match(/<[^:>]*:?lock\b[^>]*(?:\/>|>)/i)?.[0] || "", "val"),
    sourcePart
  };
}

function appendDocxContentControlElements(elements = [], xml = "", { sourcePart = "", lineStart = 0, headerFooter = null } = {}) {
  let count = 0;
  for (const match of String(xml || "").matchAll(/<[^:>]*:?sdt\b[\s\S]*?<\/[^:>]*:?sdt>/g)) {
    const sdtXml = match[0];
    const text = compactMarkupText(
      textFromXmlTextNodes(sdtXml.match(/<[^:>]*:?sdtContent\b[\s\S]*?<\/[^:>]*:?sdtContent>/i)?.[0] || sdtXml),
      1600
    );
    if (!text) {
      continue;
    }
    count += 1;
    const control = docxContentControlProperties(sdtXml, sourcePart, count);
    const label = control.alias || control.tag || control.id || `control-${count}`;
    pushStructureElement(elements, "content-control", `Content control ${label}: ${text}`, {
      line: lineStart + count,
      name: `${sourcePart}#content-control-${control.id || count}`,
      control,
      headerFooter,
      limit: 1800
    });
  }
  return count;
}

function appendDocxBookmarkElements(elements = [], xml = "", { sourcePart = "", lineStart = 0, headerFooter = null } = {}) {
  let count = 0;
  for (const paragraphMatch of String(xml || "").matchAll(/<[^:>]*:?p\b[\s\S]*?<\/[^:>]*:?p>/g)) {
    const paragraphXml = paragraphMatch[0];
    for (const bookmarkMatch of paragraphXml.matchAll(/<[^:>]*:?bookmarkStart\b[^>]*(?:\/>|>)/g)) {
      const tag = bookmarkMatch[0];
      const id = xmlLocalAttribute(tag, "id") || String(count + 1);
      const name = xmlLocalAttribute(tag, "name") || `bookmark-${id}`;
      if (!name || /^_/.test(name)) {
        continue;
      }
      const text = compactMarkupText(textFromXmlTextNodes(paragraphXml) || name, 1600);
      if (!text) {
        continue;
      }
      count += 1;
      pushStructureElement(elements, "bookmark", `Bookmark ${name}: ${text}`, {
        line: lineStart + count,
        name: `${sourcePart}#bookmark-${name}`,
        headerFooter,
        bookmark: {
          kind: "word-bookmark",
          id,
          name,
          sourcePart
        },
        limit: 1800
      });
    }
  }
  return count;
}

function removeDocxTables(xml = "") {
  return String(xml || "").replace(/<[^:>]*:?tbl\b[\s\S]*?<\/[^:>]*:?tbl>/g, " ");
}

function docxTableCells(rowXml = "") {
  return Array.from(String(rowXml || "").matchAll(/<[^:>]*:?tc\b[\s\S]*?<\/[^:>]*:?tc>/g))
    .map((match) => textFromXmlTextNodes(match[0]))
    .map((cell) => compactMarkupText(cell, 1000))
    .filter(Boolean);
}

function formatDocxTableHeader(tableLabel = "", rowNumber = 1, cells = []) {
  return `${tableLabel} Header row ${rowNumber}: ${cells.map((cell, index) => `${xlsxColumnLabel("", index)}=${cell}`).join("; ")}`;
}

function formatDocxTableRow(tableLabel = "", rowNumber = 1, cells = [], headers = []) {
  return `${tableLabel} Row ${rowNumber}: ${cells.map((cell, index) => {
    const header = headers[index] || `Column ${index + 1}`;
    return `${header}=${cell}`;
  }).join("; ")}`;
}

function appendDocxTableElements(elements = [], tableXml = "", { name = "", tableIndex = 0, lineStart = 0, headerFooter = null } = {}) {
  const tableLabel = `Table ${tableIndex}`;
  const rows = Array.from(String(tableXml || "").matchAll(/<[^:>]*:?tr\b[\s\S]*?<\/[^:>]*:?tr>/g))
    .map((match) => docxTableCells(match[0]))
    .filter((cells) => cells.length);
  if (!rows.length) {
    return { rowCount: 0, cellCount: 0, headerCells: [] };
  }
  const headers = rows[0];
  let cellCount = 0;
  for (const [rowIndex, cells] of rows.entries()) {
    cellCount += cells.length;
    const rowNumber = rowIndex + 1;
    const type = rowIndex === 0 ? "table-header" : "table-row";
    const text = rowIndex === 0
      ? formatDocxTableHeader(tableLabel, rowNumber, cells)
      : formatDocxTableRow(tableLabel, rowNumber, cells, headers);
    pushStructureElement(elements, type, text, {
      line: lineStart + rowNumber,
      name: `${name}#table-${tableIndex}`,
      headerFooter,
      table: {
        format: "docx",
        sheet: tableLabel,
        row: rowNumber,
        columns: cells.length
      },
      cells: cells.map((cell, cellIndex) => ({
        ref: `${xlsxColumnLabel("", cellIndex)}${rowNumber}`,
        column: xlsxColumnLabel("", cellIndex),
        row: rowNumber,
        header: rowIndex === 0 ? "" : headers[cellIndex] || "",
        value: cell
      }))
    });
  }
  return { rowCount: rows.length, cellCount, headerCells: headers };
}

function appendDocxAnnotationElements(elements = [], xml = "", {
  tagName = "comment",
  type = "comment",
  sourcePart = "",
  lineStart = 0
} = {}) {
  let count = 0;
  for (const match of String(xml || "").matchAll(new RegExp(`<[^:>]*:?${tagName}\\b[\\s\\S]*?<\\/[^:>]*:?${tagName}>`, "g"))) {
    const annotationXml = match[0];
    const openTag = annotationXml.match(/^<[^>]+>/)?.[0] || "";
    const annotationType = xmlLocalAttribute(openTag, "type");
    if (/^(separator|continuationSeparator|continuationNotice)$/i.test(annotationType)) {
      continue;
    }
    const text = textFromXmlTextNodes(annotationXml);
    if (!text) {
      continue;
    }
    count += 1;
    const id = xmlLocalAttribute(openTag, "id") || String(count);
    const author = xmlLocalAttribute(openTag, "author");
    const date = xmlLocalAttribute(openTag, "date");
    const label = type === "comment"
      ? `Comment ${id}${author ? ` by ${author}` : ""}`
      : `${type === "footnote" ? "Footnote" : "Endnote"} ${id}`;
    pushStructureElement(elements, type, `${label}: ${text}`, {
      line: lineStart + count,
      name: `${sourcePart}#${type}-${id}`,
      annotation: {
        kind: type,
        id,
        ...(author ? { author } : {}),
        ...(date ? { date } : {}),
        ...(annotationType ? { type: annotationType } : {}),
        sourcePart
      }
    });
  }
  return count;
}

function appendDocxAnnotations(elements = [], entries = [], lineStart = 0) {
  const comments = appendDocxAnnotationElements(elements, zipEntryText(entries, "word/comments.xml"), {
    tagName: "comment",
    type: "comment",
    sourcePart: "word/comments.xml",
    lineStart
  });
  const footnotes = appendDocxAnnotationElements(elements, zipEntryText(entries, "word/footnotes.xml"), {
    tagName: "footnote",
    type: "footnote",
    sourcePart: "word/footnotes.xml",
    lineStart: lineStart + comments
  });
  const endnotes = appendDocxAnnotationElements(elements, zipEntryText(entries, "word/endnotes.xml"), {
    tagName: "endnote",
    type: "endnote",
    sourcePart: "word/endnotes.xml",
    lineStart: lineStart + comments + footnotes
  });
  return {
    commentCount: comments,
    footnoteCount: footnotes,
    endnoteCount: endnotes,
    annotationCount: comments + footnotes + endnotes
  };
}

function textFromDocxRevisionXml(xml = "") {
  const values = [];
  for (const match of String(xml || "").matchAll(/<[^:>]*:?(?:t|delText)(?:\s[^>]*)?>([\s\S]*?)<\/[^:>]*:?(?:t|delText)>/g)) {
    values.push(decodeXmlEntities(match[1]));
  }
  if (values.length) {
    return values.join(" ").replace(/\s+/g, " ").trim();
  }
  return textFromXmlTextNodes(xml);
}

function appendDocxRevisionElements(elements = [], xml = "", { sourcePart = "", lineStart = 0, headerFooter = null } = {}) {
  let insertionCount = 0;
  let deletionCount = 0;
  let count = 0;
  for (const match of String(xml || "").matchAll(/<[^:>]*:?(ins|del)\b[\s\S]*?<\/[^:>]*:?\1>/g)) {
    const revisionXml = match[0];
    const revisionKind = String(match[1] || "").toLowerCase() === "del" ? "deletion" : "insertion";
    const openTag = revisionXml.match(/^<[^>]+>/)?.[0] || "";
    const text = textFromDocxRevisionXml(revisionXml);
    if (!text) {
      continue;
    }
    count += 1;
    if (revisionKind === "deletion") {
      deletionCount += 1;
    } else {
      insertionCount += 1;
    }
    const id = xmlLocalAttribute(openTag, "id") || String(count);
    const author = xmlLocalAttribute(openTag, "author");
    const date = xmlLocalAttribute(openTag, "date");
    pushStructureElement(elements, "revision", `Revision ${id} ${revisionKind}${author ? ` by ${author}` : ""}: ${text}`, {
      line: lineStart + count,
      name: `${sourcePart}#revision-${id}`,
      headerFooter,
      annotation: {
        kind: "word-revision",
        id,
        type: revisionKind,
        ...(author ? { author } : {}),
        ...(date ? { date } : {}),
        sourcePart
      },
      limit: 1800
    });
  }
  return {
    revisionCount: count,
    insertionRevisionCount: insertionCount,
    deletionRevisionCount: deletionCount
  };
}

function docxRelationshipEntryName(partName = "") {
  const normalized = String(partName || "").replace(/\\/g, "/");
  const directory = normalized.slice(0, normalized.lastIndexOf("/") + 1);
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return `${directory}_rels/${fileName}.rels`;
}

function parseDocxRelationshipTargets(xml = "") {
  const relationships = new Map();
  for (const match of String(xml || "").matchAll(/<Relationship\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    const id = xmlAttribute(tag, "Id");
    const target = xmlAttribute(tag, "Target");
    if (!id || !target) {
      continue;
    }
    relationships.set(id, {
      id,
      target,
      targetMode: xmlAttribute(tag, "TargetMode"),
      type: xmlAttribute(tag, "Type")
    });
  }
  return relationships;
}

function docxPartRelationships(entries = [], partName = "") {
  return parseDocxRelationshipTargets(zipEntryText(entries, docxRelationshipEntryName(partName)));
}

function officeRelationshipResolvedTarget(partName = "", relationship = null) {
  const target = String(relationship?.target || "");
  if (!target) {
    return "";
  }
  if (/^(https?:|mailto:|#)/i.test(target) || /^External$/i.test(relationship?.targetMode || "")) {
    return target;
  }
  const normalizedPart = String(partName || "").replace(/\\/g, "/");
  const directory = normalizedPart.includes("/")
    ? normalizedPart.slice(0, normalizedPart.lastIndexOf("/") + 1)
    : "";
  return path.posix.normalize(`${directory}${target}`).replace(/^\/+/, "").replace(/^\.\//, "");
}

function officeImageMetadataFromFragment(fragmentXml = "", fallbackName = "") {
  const docPrTag = String(fragmentXml || "").match(/<[^:>]*:?docPr\b[^>]*(?:\/>|>)/i)?.[0] || "";
  const cNvPrTag = String(fragmentXml || "").match(/<[^:>]*:?cNvPr\b[^>]*(?:\/>|>)/i)?.[0] || "";
  const tag = docPrTag || cNvPrTag;
  return {
    id: xmlLocalAttribute(tag, "id"),
    name: xmlLocalAttribute(tag, "name") || fallbackName,
    title: xmlLocalAttribute(tag, "title"),
    description: xmlLocalAttribute(tag, "descr")
  };
}

function officeImageRefsFromXml(fragmentXml = "", relationships = new Map(), {
  sourcePart = "",
  fallbackName = "",
  page = 0,
  order = 0
} = {}) {
  const refs = [];
  const seen = new Set();
  const metadata = officeImageMetadataFromFragment(fragmentXml, fallbackName);
  const pushRef = (tag = "", attrNames = []) => {
    const relationshipId = attrNames.map((attr) => xmlLocalAttribute(tag, attr)).find(Boolean) || "";
    if (!relationshipId) {
      return;
    }
    const relationship = relationships.get(relationshipId) || null;
    const target = officeRelationshipResolvedTarget(sourcePart, relationship);
    if (!target && !/\/image$/i.test(relationship?.type || "")) {
      return;
    }
    const key = `${relationshipId}:${target}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push({
      relationshipId,
      target,
      href: target || relationshipId,
      targetMode: relationship?.targetMode || "",
      type: relationship?.type || "",
      sourcePart,
      page: Number(page || 0),
      order: Number(order || 0),
      name: metadata.name || fallbackName,
      title: metadata.title,
      description: metadata.description,
      text: metadata.description || metadata.title || metadata.name || fallbackName || `Image ${refs.length + 1}`
    });
  };
  for (const match of String(fragmentXml || "").matchAll(/<[^:>]*:?blip\b[^>]*(?:\/>|>)/g)) {
    pushRef(match[0], ["embed", "link"]);
  }
  for (const match of String(fragmentXml || "").matchAll(/<[^:>]*:?imagedata\b[^>]*(?:\/>|>)/g)) {
    pushRef(match[0], ["id", "href"]);
  }
  return refs;
}

function officeChartValueNodes(xml = "", limit = 40) {
  const values = [];
  for (const match of String(xml || "").matchAll(/<[^:>]*:?v(?:\s[^>]*)?>([\s\S]*?)<\/[^:>]*:?v>/g)) {
    const value = compactMarkupText(decodeXmlEntities(match[1] || ""), 300);
    if (value) {
      values.push(value);
    }
    if (values.length >= limit) {
      break;
    }
  }
  return uniqueOrdered(values);
}

function officeChartTypeFromXml(xml = "") {
  const match = String(xml || "").match(/<(?:[\w.-]+:)?([A-Za-z]+Chart)\b/i);
  return match ? match[1] : "";
}

function officeChartTitleFromXml(xml = "", fallback = "") {
  const titleXml = String(xml || "").match(/<[^:>]*:?title\b[\s\S]*?<\/[^:>]*:?title>/i)?.[0] || "";
  return compactMarkupText(textFromXmlTextNodes(titleXml) || officeChartValueNodes(titleXml, 1)[0] || fallback, 300);
}

function officeChartSeriesFromXml(xml = "") {
  const series = [];
  for (const match of String(xml || "").matchAll(/<[^:>]*:?ser\b[\s\S]*?<\/[^:>]*:?ser>/g)) {
    const seriesXml = match[0];
    const txXml = seriesXml.match(/<[^:>]*:?tx\b[\s\S]*?<\/[^:>]*:?tx>/i)?.[0] || "";
    const catXml = seriesXml.match(/<[^:>]*:?cat\b[\s\S]*?<\/[^:>]*:?cat>/i)?.[0] || "";
    const valXml = seriesXml.match(/<[^:>]*:?val\b[\s\S]*?<\/[^:>]*:?val>/i)?.[0] || "";
    series.push({
      name: compactMarkupText(textFromXmlTextNodes(txXml) || officeChartValueNodes(txXml, 1)[0] || `Series ${series.length + 1}`, 300),
      categories: officeChartValueNodes(catXml, 20),
      values: officeChartValueNodes(valXml, 20)
    });
    if (series.length >= 20) {
      break;
    }
  }
  return series;
}

function officeChartRefsFromXml(fragmentXml = "", relationships = new Map(), entries = [], {
  sourcePart = "",
  fallbackName = "",
  format = "",
  page = 0,
  order = 0,
  sheetName = "",
  sheetId = "",
  worksheetPath = ""
} = {}) {
  const refs = [];
  const seen = new Set();
  for (const match of String(fragmentXml || "").matchAll(/<[^:>]*:?chart\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    const relationshipId = xmlLocalAttribute(tag, "id");
    if (!relationshipId) {
      continue;
    }
    const relationship = relationships.get(relationshipId) || null;
    const target = officeRelationshipResolvedTarget(sourcePart, relationship);
    if (!target && !/\/chart$/i.test(relationship?.type || "")) {
      continue;
    }
    const chartPart = target || relationshipId;
    const key = `${relationshipId}:${chartPart}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const chartXml = target ? zipEntryText(entries, target) : "";
    const chartType = officeChartTypeFromXml(chartXml);
    const title = officeChartTitleFromXml(chartXml, fallbackName || `Chart ${refs.length + 1}`);
    const series = officeChartSeriesFromXml(chartXml);
    refs.push({
      format,
      relationshipId,
      target,
      targetMode: relationship?.targetMode || "",
      type: relationship?.type || "",
      sourcePart,
      chartPart,
      title,
      chartType,
      seriesCount: series.length,
      series,
      page: Number(page || 0),
      order: Number(order || refs.length + 1),
      sheetName,
      sheetId,
      worksheetPath,
      text: compactMarkupText([
        title,
        chartType,
        series.length ? `${series.length} series` : ""
      ].filter(Boolean).join(" - "), 600) || fallbackName || chartPart
    });
  }
  return refs;
}

function appendOfficeChartElements(elements = [], entries = [], fragmentXml = "", relationships = new Map(), {
  sourcePart = "",
  fallbackName = "",
  format = "",
  page = 0,
  lineStart = 0,
  chartStart = 0,
  order = 0,
  bbox = null,
  layout = null,
  shape = null,
  table = null,
  headerFooter = null,
  sheetName = "",
  sheetId = "",
  worksheetPath = ""
} = {}) {
  const chartRefs = officeChartRefsFromXml(fragmentXml, relationships, entries, {
    sourcePart,
    fallbackName,
    format,
    page,
    order,
    sheetName,
    sheetId,
    worksheetPath
  });
  let count = 0;
  let chartPartCount = 0;
  let chartSeriesCount = 0;
  const seenChartParts = new Set();
  for (const chart of chartRefs) {
    count += 1;
    if (chart.chartPart && !seenChartParts.has(chart.chartPart)) {
      chartPartCount += 1;
      seenChartParts.add(chart.chartPart);
    }
    chartSeriesCount += Number(chart.seriesCount || 0);
    pushStructureElement(elements, "chart", chart.text, {
      line: lineStart + count,
      name: `${sourcePart}#chart-${chartStart + count}`,
      page,
      href: chart.target || chart.chartPart,
      bbox,
      layout,
      shape,
      table,
      headerFooter,
      chart
    });
  }
  return { count, chartPartCount, chartSeriesCount };
}

function docxParagraphHyperlinks(paragraphXml = "", relationships = new Map()) {
  const links = [];
  for (const match of String(paragraphXml || "").matchAll(/<[^:>]*:?hyperlink\b[\s\S]*?<\/[^:>]*:?hyperlink>/g)) {
    const hyperlinkXml = match[0];
    const openTag = hyperlinkXml.match(/^<[^>]+>/)?.[0] || "";
    const relationshipId = xmlLocalAttribute(openTag, "id");
    const relationship = relationships.get(relationshipId) || null;
    const anchor = xmlLocalAttribute(openTag, "anchor");
    const target = relationship?.target || (anchor ? `#${anchor}` : "");
    const text = compactMarkupText(textFromXmlTextNodes(hyperlinkXml), 1200);
    if (!text || !target) {
      continue;
    }
    links.push({
      text,
      target,
      anchor,
      relationshipId,
      targetMode: relationship?.targetMode || "",
      type: relationship?.type || "",
      tooltip: xmlLocalAttribute(openTag, "tooltip")
    });
  }
  return links;
}

function appendDocxImageElements(elements = [], xml = "", relationships = new Map(), {
  partName = "",
  lineStart = 0,
  imageStart = 0,
  headerFooter = null
} = {}) {
  let count = 0;
  const fragments = [
    ...Array.from(String(xml || "").matchAll(/<[^:>]*:?drawing\b[\s\S]*?<\/[^:>]*:?drawing>/g)).map((match) => match[0]),
    ...Array.from(String(xml || "").matchAll(/<[^:>]*:?pict\b[\s\S]*?<\/[^:>]*:?pict>/g)).map((match) => match[0])
  ];
  for (const fragment of fragments) {
    const imageRefs = officeImageRefsFromXml(fragment, relationships, {
      sourcePart: partName,
      fallbackName: `Word Image ${imageStart + count + 1}`,
      order: imageStart + count + 1
    });
    for (const image of imageRefs) {
      count += 1;
      pushStructureElement(elements, "image", image.text, {
        line: lineStart + count,
        name: `${partName}#image-${imageStart + count}`,
        href: image.href,
        headerFooter,
        image
      });
    }
  }
  return count;
}

function parseDocx(entries = []) {
  const xmlNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name))
    .sort((left, right) => docxPartSortKey(left) - docxPartSortKey(right) || left.localeCompare(right));
  const elements = [];
  let paragraphCount = 0;
  let tableCount = 0;
  let tableRowCount = 0;
  let tableCellCount = 0;
  let contentControlCount = 0;
  let bookmarkCount = 0;
  let annotationCount = 0;
  let commentCount = 0;
  let footnoteCount = 0;
  let endnoteCount = 0;
  let hyperlinkCount = 0;
  let imageCount = 0;
  let styleRefCount = 0;
  let numberingRefCount = 0;
  let revisionCount = 0;
  let insertionRevisionCount = 0;
  let deletionRevisionCount = 0;
  let chartCount = 0;
  let chartPartCount = 0;
  let chartSeriesCount = 0;
  for (const name of xmlNames) {
    const xml = zipEntryText(entries, name);
    const relationships = docxPartRelationships(entries, name);
    const headerFooter = docxHeaderFooterMetadata(name);
    contentControlCount += appendDocxContentControlElements(elements, xml, {
      sourcePart: name,
      lineStart: paragraphCount + tableRowCount + contentControlCount,
      headerFooter
    });
    bookmarkCount += appendDocxBookmarkElements(elements, xml, {
      sourcePart: name,
      lineStart: paragraphCount + tableRowCount + contentControlCount + bookmarkCount,
      headerFooter
    });
    for (const tableMatch of xml.matchAll(/<[^:>]*:?tbl\b[\s\S]*?<\/[^:>]*:?tbl>/g)) {
      tableCount += 1;
      const table = appendDocxTableElements(elements, tableMatch[0], {
        name,
        tableIndex: tableCount,
        lineStart: paragraphCount + tableRowCount,
        headerFooter
      });
      tableRowCount += table.rowCount;
      tableCellCount += table.cellCount;
    }
    const paragraphXmlSource = removeDocxTables(xml);
    let foundParagraph = false;
    for (const match of paragraphXmlSource.matchAll(/<[^:>]*:?p\b[\s\S]*?<\/[^:>]*:?p>/g)) {
      foundParagraph = true;
      const paragraphXml = match[0];
      const text = textFromXmlTextNodes(paragraphXml);
      if (!text) {
        continue;
      }
      paragraphCount += 1;
      const style = docxParagraphStyle(paragraphXml);
      const styleProfile = docxParagraphStyleProfile(paragraphXml, style);
      const { type, level } = docxParagraphElementType(paragraphXml, style);
      if (styleProfile.styleId) {
        styleRefCount += 1;
      }
      if (styleProfile.numberingId) {
        numberingRefCount += 1;
      }
      pushStructureElement(elements, headerFooter?.kind || type, headerFooter ? `${headerFooter.label}: ${text}` : text, {
        level,
        line: paragraphCount,
        name,
        headerFooter,
        ...(Object.keys(styleProfile).length ? { style: styleProfile } : {})
      });
      for (const link of docxParagraphHyperlinks(paragraphXml, relationships)) {
        hyperlinkCount += 1;
        pushStructureElement(elements, "link", link.text, {
          line: paragraphCount,
          name: `${name}#link-${hyperlinkCount}`,
          href: link.target,
          headerFooter
        });
      }
    }
    imageCount += appendDocxImageElements(elements, xml, relationships, {
      partName: name,
      lineStart: paragraphCount + tableRowCount + annotationCount,
      imageStart: imageCount,
      headerFooter
    });
    const charts = appendOfficeChartElements(elements, entries, xml, relationships, {
      sourcePart: name,
      format: "docx",
      fallbackName: `Word Chart ${chartCount + 1}`,
      lineStart: paragraphCount + tableRowCount + annotationCount + imageCount + chartCount,
      chartStart: chartCount,
      headerFooter
    });
    chartCount += charts.count;
    chartPartCount += charts.chartPartCount;
    chartSeriesCount += charts.chartSeriesCount;
    const revisions = appendDocxRevisionElements(elements, xml, {
      sourcePart: name,
      lineStart: paragraphCount + tableRowCount + annotationCount + imageCount + chartCount + revisionCount,
      headerFooter
    });
    revisionCount += revisions.revisionCount;
    insertionRevisionCount += revisions.insertionRevisionCount;
    deletionRevisionCount += revisions.deletionRevisionCount;
    if (!foundParagraph) {
      const text = textFromXmlTextNodes(xml);
      if (text) {
        paragraphCount += 1;
        pushStructureElement(elements, headerFooter?.kind || "paragraph", headerFooter ? `${headerFooter.label}: ${text}` : text, { line: paragraphCount, name, headerFooter });
      }
    }
  }
  const annotations = appendDocxAnnotations(elements, entries, paragraphCount + tableRowCount);
  annotationCount = annotations.annotationCount;
  commentCount = annotations.commentCount;
  footnoteCount = annotations.footnoteCount;
  endnoteCount = annotations.endnoteCount;
  const fallback = xmlNames.map((name) => textFromXmlTextNodes(zipEntryText(entries, name))).filter(Boolean).join("\n\n");
  const counts = elementTypeCounts(elements);
  const headerPartCount = xmlNames.filter((name) => docxHeaderFooterMetadata(name)?.kind === "header").length;
  const footerPartCount = xmlNames.filter((name) => docxHeaderFooterMetadata(name)?.kind === "footer").length;
  const headerElementCount = elements.filter((element) => element.headerFooter?.kind === "header" || element.type === "header").length;
  const footerElementCount = elements.filter((element) => element.headerFooter?.kind === "footer" || element.type === "footer").length;
  const headerFooterElementCount = headerElementCount + footerElementCount;
  return {
    text: structureElementsToText("docx", elements, fallback),
    elements,
    format: "docx",
    xmlFileCount: xmlNames.length,
    headerPartCount,
    footerPartCount,
    headerFooterElementCount,
    headerElementCount,
    footerElementCount,
    paragraphCount,
    tableCount,
    tableRowCount,
    tableCellCount,
    contentControlCount,
    bookmarkCount,
    annotationCount,
    commentCount,
    footnoteCount,
    endnoteCount,
    hyperlinkCount,
    imageCount,
    styleRefCount,
    numberingRefCount,
    revisionCount,
    insertionRevisionCount,
    deletionRevisionCount,
    chartCount,
    chartPartCount,
    chartSeriesCount,
    headingCount: (counts.title || 0) + (counts.heading || 0),
    listItemCount: counts["list-item"] || 0
  };
}

function pptxEmuToPoints(value = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundLayoutNumber(parsed / 12700) : 0;
}

function pptxShapeName(shapeXml = "", fallback = "") {
  const nameTag = String(shapeXml || "").match(/<[^:>]*:?cNvPr\b[^>]*>/i)?.[0] || "";
  return xmlLocalAttribute(nameTag, "name") || fallback;
}

function pptxShapeMetadata(shapeXml = "", {
  fallbackName = "",
  slideNumber = 0,
  order = 0
} = {}) {
  const nameTag = String(shapeXml || "").match(/<[^:>]*:?cNvPr\b[^>]*>/i)?.[0] || "";
  const placeholderTag = String(shapeXml || "").match(/<[^:>]*:?ph\b[^>]*(?:\/>|>)/i)?.[0] || "";
  const name = xmlLocalAttribute(nameTag, "name") || fallbackName;
  const metadata = {
    id: xmlLocalAttribute(nameTag, "id"),
    name,
    slide: Number(slideNumber || 0),
    order: Number(order || 0),
    isPlaceholder: Boolean(placeholderTag),
    placeholderType: xmlLocalAttribute(placeholderTag, "type"),
    placeholderIndex: xmlLocalAttribute(placeholderTag, "idx"),
    placeholderSize: xmlLocalAttribute(placeholderTag, "sz")
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => (
    value !== "" && value !== null && value !== undefined && value !== false
  )));
}

function pptxShapeElementType(shape = {}, shapeIndex = 0) {
  const placeholderType = String(shape.placeholderType || "").toLowerCase();
  if (["title", "ctrtitle", "subtitle"].includes(placeholderType)) {
    return "heading";
  }
  if (shapeIndex === 0 && !shape.isPlaceholder) {
    return "heading";
  }
  return "slide-shape";
}

function pptxShapeHeadingLevel(shape = {}, shapeIndex = 0) {
  const placeholderType = String(shape.placeholderType || "").toLowerCase();
  if (placeholderType === "subtitle") {
    return 2;
  }
  if (["title", "ctrtitle"].includes(placeholderType) || (shapeIndex === 0 && !shape.isPlaceholder)) {
    return 1;
  }
  return 0;
}

function pptxShapeGeometry(shapeXml = "", slideNumber = 0, order = 0) {
  const xfrm = String(shapeXml || "").match(/<[^:>]*:?xfrm\b[\s\S]*?<\/[^:>]*:?xfrm>/i)?.[0] || "";
  const offTag = xfrm.match(/<[^:>]*:?off\b[^>]*>/i)?.[0] || "";
  const extTag = xfrm.match(/<[^:>]*:?ext\b[^>]*>/i)?.[0] || "";
  if (!offTag && !extTag) {
    return { bbox: null, layout: null };
  }
  const bbox = {
    x: pptxEmuToPoints(xmlLocalAttribute(offTag, "x")),
    y: pptxEmuToPoints(xmlLocalAttribute(offTag, "y")),
    width: pptxEmuToPoints(xmlLocalAttribute(extTag, "cx")),
    height: pptxEmuToPoints(xmlLocalAttribute(extTag, "cy"))
  };
  return {
    bbox,
    layout: {
      strategy: "presentationml-shape-geometry.v1",
      page: slideNumber,
      order,
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height
    }
  };
}

function pptxPartNumber(partName = "", pattern = /(\d+)/) {
  return Number(String(partName || "").match(pattern)?.[1] || 0);
}

function pptxSlideLayoutMasterRef(entries = [], slideName = "", slideRelationships = new Map()) {
  const slideLayoutRelationship = [...slideRelationships.values()].find((relationship) => (
    /\/slideLayout$/i.test(relationship.type || "") ||
    /(^|\/)slideLayouts\/slideLayout\d+\.xml$/i.test(relationship.target || "")
  )) || null;
  if (!slideLayoutRelationship) {
    return null;
  }
  const layoutPart = officeRelationshipResolvedTarget(slideName, slideLayoutRelationship);
  if (!layoutPart) {
    return null;
  }
  const layoutXml = zipEntryText(entries, layoutPart);
  const layoutRelationships = docxPartRelationships(entries, layoutPart);
  const slideMasterRelationship = [...layoutRelationships.values()].find((relationship) => (
    /\/slideMaster$/i.test(relationship.type || "") ||
    /(^|\/)slideMasters\/slideMaster\d+\.xml$/i.test(relationship.target || "")
  )) || null;
  const masterPart = slideMasterRelationship
    ? officeRelationshipResolvedTarget(layoutPart, slideMasterRelationship)
    : "";
  const masterXml = masterPart ? zipEntryText(entries, masterPart) : "";
  const layoutName = xmlLocalAttribute(String(layoutXml || "").match(/<[^:>]*:?cSld\b[^>]*(?:\/>|>)/i)?.[0] || "", "name") ||
    `Slide Layout ${pptxPartNumber(layoutPart, /slideLayout(\d+)/) || ""}`.trim();
  const masterName = xmlLocalAttribute(String(masterXml || "").match(/<[^:>]*:?cSld\b[^>]*(?:\/>|>)/i)?.[0] || "", "name") ||
    `Slide Master ${pptxPartNumber(masterPart, /slideMaster(\d+)/) || ""}`.trim();
  return {
    slidePart: slideName,
    layoutPart,
    layoutRelationshipId: slideLayoutRelationship.id || "",
    layoutRelationshipType: slideLayoutRelationship.type || "",
    layoutName,
    layoutText: compactMarkupText(textFromXmlTextNodes(layoutXml), 1600),
    masterPart,
    masterRelationshipId: slideMasterRelationship?.id || "",
    masterRelationshipType: slideMasterRelationship?.type || "",
    masterName,
    masterText: compactMarkupText(textFromXmlTextNodes(masterXml), 1600)
  };
}

function appendPptxLayoutMasterElements(elements = [], layoutRef = null, {
  slideNumber = 0,
  lineStart = 0
} = {}) {
  if (!layoutRef?.layoutPart) {
    return { layoutRefCount: 0, masterRefCount: 0 };
  }
  const base = {
    slide: Number(slideNumber || 0),
    slidePart: layoutRef.slidePart || "",
    layoutPart: layoutRef.layoutPart || "",
    relationshipId: layoutRef.layoutRelationshipId || "",
    layoutRelationshipId: layoutRef.layoutRelationshipId || "",
    layoutRelationshipType: layoutRef.layoutRelationshipType || "",
    layoutName: layoutRef.layoutName || "",
    masterPart: layoutRef.masterPart || "",
    masterRelationshipId: layoutRef.masterRelationshipId || "",
    masterRelationshipType: layoutRef.masterRelationshipType || "",
    masterName: layoutRef.masterName || ""
  };
  pushStructureElement(
    elements,
    "slide-layout",
    `Slide ${slideNumber} layout ${layoutRef.layoutName || layoutRef.layoutPart}: ${layoutRef.layoutText || layoutRef.layoutPart}`,
    {
      line: lineStart + 1,
      name: `${layoutRef.slidePart || `slide-${slideNumber}`}#layout`,
      page: slideNumber,
      layout: {
        strategy: "presentationml-slide-layout-ref.v1",
        page: slideNumber,
        order: lineStart + 1
      },
      presentation: {
        kind: "slide-layout",
        ...base
      },
      limit: 2000
    }
  );
  let masterRefCount = 0;
  if (layoutRef.masterPart) {
    masterRefCount = 1;
    pushStructureElement(
      elements,
      "slide-master",
      `Slide ${slideNumber} master ${layoutRef.masterName || layoutRef.masterPart}: ${layoutRef.masterText || layoutRef.masterPart}`,
      {
        line: lineStart + 2,
        name: `${layoutRef.slidePart || `slide-${slideNumber}`}#master`,
        page: slideNumber,
        layout: {
          strategy: "presentationml-slide-master-ref.v1",
          page: slideNumber,
          order: lineStart + 2
        },
        presentation: {
          kind: "slide-master",
          ...base
        },
        limit: 2000
      }
    );
  }
  return { layoutRefCount: 1, masterRefCount };
}

function pptxHyperlinkFromTag(tag = "", relationships = new Map(), text = "") {
  const relationshipId = xmlLocalAttribute(tag, "id");
  const relationship = relationships.get(relationshipId) || null;
  const target = relationship?.target || xmlLocalAttribute(tag, "action");
  const normalizedText = compactMarkupText(text, 1200);
  if (!normalizedText || !target) {
    return null;
  }
  return {
    text: normalizedText,
    target,
    relationshipId,
    targetMode: relationship?.targetMode || "",
    type: relationship?.type || "",
    tooltip: xmlLocalAttribute(tag, "tooltip")
  };
}

function pptxHyperlinksFromXml(fragmentXml = "", relationships = new Map(), fallbackText = "") {
  const links = [];
  const consumedTags = new Set();
  const pushTagsFromXml = (xml = "", text = "") => {
    for (const match of String(xml || "").matchAll(/<[^:>]*:?hlink(?:Click|Hover)\b[^>]*(?:\/>|>)/g)) {
      const tag = match[0];
      const link = pptxHyperlinkFromTag(tag, relationships, text);
      if (!link) {
        continue;
      }
      links.push(link);
      consumedTags.add(tag);
    }
  };
  for (const match of String(fragmentXml || "").matchAll(/<[^:>]*:?r\b[\s\S]*?<\/[^:>]*:?r>/g)) {
    const runXml = match[0];
    pushTagsFromXml(runXml, textFromXmlTextNodes(runXml) || fallbackText);
  }
  for (const match of String(fragmentXml || "").matchAll(/<[^:>]*:?hlink(?:Click|Hover)\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    if (consumedTags.has(tag)) {
      continue;
    }
    const link = pptxHyperlinkFromTag(tag, relationships, fallbackText || textFromXmlTextNodes(fragmentXml));
    if (link) {
      links.push(link);
    }
  }
  return links;
}

function pushPptxLinkElements(elements = [], links = [], {
  name = "",
  slideNumber = 0,
  line = 0,
  geometry = {},
  shape = null,
  linkStart = 0
} = {}) {
  let count = 0;
  for (const link of links) {
    count += 1;
    const layout = geometry.layout
      ? { ...geometry.layout, strategy: "presentationml-link-ref.v1" }
      : { strategy: "presentationml-link-ref.v1", page: slideNumber, order: line || count };
    pushStructureElement(elements, "link", link.text, {
      line: line || count,
      name: `${name}#link-${linkStart + count}`,
      page: slideNumber,
      href: link.target,
      bbox: geometry.bbox || null,
      layout,
      shape
    });
  }
  return count;
}

function pptxTableCells(rowXml = "") {
  const cells = [];
  for (const match of String(rowXml || "").matchAll(/<[^:>]*:?tc\b[\s\S]*?<\/[^:>]*:?tc>/g)) {
    cells.push(compactMarkupText(textFromXmlTextNodes(match[0]), 1000));
  }
  return cells;
}

function appendPptxTableElements(elements = [], frameXml = "", { slideNumber = 0, tableIndex = 0, order = 0 } = {}) {
  const tableXml = String(frameXml || "").match(/<[^:>]*:?tbl\b[\s\S]*?<\/[^:>]*:?tbl>/i)?.[0] || "";
  const tableLabel = pptxShapeName(frameXml, `Slide ${slideNumber} Table ${tableIndex}`);
  const rows = [];
  for (const match of tableXml.matchAll(/<[^:>]*:?tr\b[\s\S]*?<\/[^:>]*:?tr>/g)) {
    const cells = pptxTableCells(match[0]);
    if (cells.some(Boolean)) {
      rows.push(cells);
    }
  }
  if (!rows.length) {
    return { rowCount: 0, cellCount: 0, geometryCount: 0 };
  }
  const geometry = pptxShapeGeometry(frameXml, slideNumber, order);
  const shape = pptxShapeMetadata(frameXml, {
    fallbackName: tableLabel,
    slideNumber,
    order
  });
  const tableLayout = geometry.layout
    ? { ...geometry.layout, strategy: "presentationml-table-geometry.v1" }
    : { strategy: "presentationml-table-geometry.v1", page: slideNumber, order };
  const headers = rows[0];
  let cellCount = 0;
  for (const [rowIndex, cells] of rows.entries()) {
    const rowNumber = rowIndex + 1;
    cellCount += cells.length;
    const type = rowIndex === 0 ? "table-header" : "table-row";
    const text = rowIndex === 0
      ? `Slide ${slideNumber} ${tableLabel} Header row ${rowNumber}: ${cells.map((cell, cellIndex) => `${xlsxColumnLabel("", cellIndex)}=${cell}`).join("; ")}`
      : `Slide ${slideNumber} ${tableLabel} Row ${rowNumber}: ${cells.map((cell, cellIndex) => `${headers[cellIndex] || `Column ${cellIndex + 1}`}=${cell}`).join("; ")}`;
    pushStructureElement(elements, type, text, {
      line: rowNumber,
      name: `slide-${slideNumber}#${tableLabel}`,
      page: slideNumber,
      bbox: geometry.bbox,
      layout: tableLayout,
      shape,
      table: {
        format: "presentationml",
        sheet: tableLabel,
        row: rowNumber,
        columns: cells.length
      },
      cells: cells.map((cell, cellIndex) => ({
        ref: `${xlsxColumnLabel("", cellIndex)}${rowNumber}`,
        column: xlsxColumnLabel("", cellIndex),
        row: rowNumber,
        header: rowIndex === 0 ? "" : headers[cellIndex] || "",
        value: cell
      }))
    });
  }
  return { rowCount: rows.length, cellCount, geometryCount: geometry.bbox ? 1 : 0 };
}

function appendPptxImageElements(elements = [], pictureXml = "", relationships = new Map(), {
  slideNumber = 0,
  imageIndex = 0,
  order = 0,
  sourcePart = ""
} = {}) {
  const geometry = pptxShapeGeometry(pictureXml, slideNumber, order || imageIndex);
  const shapeName = pptxShapeName(pictureXml, `Slide ${slideNumber} Image ${imageIndex}`);
  const shape = pptxShapeMetadata(pictureXml, {
    fallbackName: shapeName,
    slideNumber,
    order: order || imageIndex
  });
  const imageRefs = officeImageRefsFromXml(pictureXml, relationships, {
    sourcePart,
    fallbackName: shapeName,
    page: slideNumber,
    order: order || imageIndex
  });
  let count = 0;
  for (const image of imageRefs) {
    count += 1;
    const layout = geometry.layout
      ? { ...geometry.layout, strategy: "presentationml-image-ref.v1" }
      : { strategy: "presentationml-image-ref.v1", page: slideNumber, order: order || imageIndex };
    pushStructureElement(elements, "image", image.text, {
      line: order || imageIndex,
      name: `${sourcePart}#image-${imageIndex + count - 1}`,
      page: slideNumber,
      href: image.href,
      bbox: geometry.bbox,
      layout,
      shape,
      image
    });
  }
  return { count, geometryCount: count && geometry.bbox ? 1 : 0 };
}

function pptxCommentAuthors(entries = []) {
  const authors = new Map();
  const xml = zipEntryText(entries, "ppt/commentAuthors.xml");
  for (const match of String(xml || "").matchAll(/<[^:>]*:?cmAuthor\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    const id = xmlLocalAttribute(tag, "id");
    if (!id) {
      continue;
    }
    authors.set(id, {
      id,
      name: xmlLocalAttribute(tag, "name"),
      initials: xmlLocalAttribute(tag, "initials"),
      lastIndex: xmlLocalAttribute(tag, "lastIdx")
    });
  }
  return authors;
}

function pptxCommentRelationships(entries = [], slideName = "", slideNumber = 0) {
  const relationships = [...docxPartRelationships(entries, slideName).values()]
    .filter((relationship) => (
      /\/comments$/i.test(relationship.type || "") ||
      /(^|\/)comments\/comment\d+\.xml$/i.test(relationship.target || "")
    ))
    .map((relationship) => ({
      ...relationship,
      target: officeRelationshipResolvedTarget(slideName, relationship)
    }));
  if (relationships.length) {
    return relationships;
  }
  const fallbackTarget = `ppt/comments/comment${slideNumber || 1}.xml`;
  return zipEntryText(entries, fallbackTarget)
    ? [{
        id: "",
        target: fallbackTarget,
        targetMode: "",
        type: "fallback-comments-part"
      }]
    : [];
}

function parsePptxCommentsXml(xml = "", {
  authors = new Map(),
  relationship = {},
  sourcePart = "",
  slideNumber = 0
} = {}) {
  const comments = [];
  for (const match of String(xml || "").matchAll(/<[^:>]*:?cm\b[\s\S]*?<\/[^:>]*:?cm>/g)) {
    const commentXml = match[0];
    const openTag = commentXml.match(/^<[^>]+>/)?.[0] || "";
    const authorId = xmlLocalAttribute(openTag, "authorId");
    const author = authors.get(authorId) || {};
    const textXml = commentXml.match(/<[^:>]*:?text\b[\s\S]*?<\/[^:>]*:?text>/i)?.[0] || commentXml;
    const text = compactMarkupText(textFromXmlTextNodes(textXml), 1800);
    if (!text) {
      continue;
    }
    const positionTag = commentXml.match(/<[^:>]*:?pos\b[^>]*(?:\/>|>)/i)?.[0] || "";
    const hasPosition = Boolean(positionTag);
    const x = hasPosition ? pptxEmuToPoints(xmlLocalAttribute(positionTag, "x")) : 0;
    const y = hasPosition ? pptxEmuToPoints(xmlLocalAttribute(positionTag, "y")) : 0;
    const id = xmlLocalAttribute(openTag, "idx") || String(comments.length + 1);
    comments.push({
      id,
      authorId,
      author: author.name || "",
      initials: author.initials || "",
      date: xmlLocalAttribute(openTag, "dt"),
      text,
      relationshipId: String(relationship.id || ""),
      target: String(sourcePart || relationship.target || ""),
      sourcePart: String(sourcePart || relationship.target || ""),
      type: String(relationship.type || ""),
      layout: hasPosition
        ? {
            strategy: "presentationml-comment-position.v1",
            page: slideNumber,
            order: comments.length + 1,
            x,
            y
          }
        : {
            strategy: "presentationml-comment-ref.v1",
            page: slideNumber,
            order: comments.length + 1
          }
    });
  }
  return comments;
}

function pptxCommentsForSlideEntries(entries = [], slideName = "", slideNumber = 0, authors = new Map()) {
  const relationships = pptxCommentRelationships(entries, slideName, slideNumber);
  const comments = [];
  for (const relationship of relationships) {
    const sourcePart = relationship.target || "";
    const xml = zipEntryText(entries, sourcePart);
    if (!xml) {
      continue;
    }
    comments.push(...parsePptxCommentsXml(xml, {
      authors,
      relationship,
      sourcePart,
      slideNumber
    }));
  }
  return comments;
}

function parsePptx(entries = []) {
  const slideNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/slide(\d+)/)?.[1] || 0) - Number(right.match(/slide(\d+)/)?.[1] || 0));
  const slideLayoutNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/slideLayout(\d+)/)?.[1] || 0) - Number(right.match(/slideLayout(\d+)/)?.[1] || 0));
  const slideMasterNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/slideMaster(\d+)/)?.[1] || 0) - Number(right.match(/slideMaster(\d+)/)?.[1] || 0));
  const noteNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/notesSlide(\d+)/)?.[1] || 0) - Number(right.match(/notesSlide(\d+)/)?.[1] || 0));
  const commentPartNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/comments\/comment\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/comment(\d+)/)?.[1] || 0) - Number(right.match(/comment(\d+)/)?.[1] || 0));
  const commentAuthors = pptxCommentAuthors(entries);
  const elements = [];
  let paragraphCount = 0;
  let shapeCount = 0;
  let shapeGeometryCount = 0;
  let tableCount = 0;
  let tableRowCount = 0;
  let tableCellCount = 0;
  let tableGeometryCount = 0;
  let speakerNoteCount = 0;
  let hyperlinkCount = 0;
  let imageCount = 0;
  let imageGeometryCount = 0;
  let chartCount = 0;
  let chartPartCount = 0;
  let chartSeriesCount = 0;
  let chartGeometryCount = 0;
  let commentCount = 0;
  let placeholderCount = 0;
  let shapeMetadataCount = 0;
  let slideLayoutRefCount = 0;
  let slideMasterRefCount = 0;
  const slideLayoutPartSet = new Set();
  const slideMasterPartSet = new Set();
  for (const [index, name] of slideNames.entries()) {
    const slideNumber = Number(name.match(/slide(\d+)/)?.[1] || index + 1);
    const xml = zipEntryText(entries, name);
    const relationships = docxPartRelationships(entries, name);
    const layoutRef = pptxSlideLayoutMasterRef(entries, name, relationships);
    if (layoutRef?.layoutPart) {
      slideLayoutPartSet.add(layoutRef.layoutPart);
    }
    if (layoutRef?.masterPart) {
      slideMasterPartSet.add(layoutRef.masterPart);
    }
    const inheritance = appendPptxLayoutMasterElements(elements, layoutRef, {
      slideNumber,
      lineStart: elements.length
    });
    slideLayoutRefCount += inheritance.layoutRefCount;
    slideMasterRefCount += inheritance.masterRefCount;
    const shapeBlocks = Array.from(xml.matchAll(/<[^:>]*:?sp\b[\s\S]*?<\/[^:>]*:?sp>/g))
      .map((match) => match[0])
      .filter((shapeXml) => textFromXmlTextNodes(shapeXml));
    const tableFrames = Array.from(xml.matchAll(/<[^:>]*:?graphicFrame\b[\s\S]*?<\/[^:>]*:?graphicFrame>/g))
      .map((match) => match[0])
      .filter((frameXml) => /<[^:>]*:?tbl\b/i.test(frameXml));
    const chartFrames = Array.from(xml.matchAll(/<[^:>]*:?graphicFrame\b[\s\S]*?<\/[^:>]*:?graphicFrame>/g))
      .map((match) => match[0])
      .filter((frameXml) => /<[^:>]*:?chart\b/i.test(frameXml));
    const pictureBlocks = Array.from(xml.matchAll(/<[^:>]*:?pic\b[\s\S]*?<\/[^:>]*:?pic>/g))
      .map((match) => match[0]);
    if (shapeBlocks.length) {
      for (const [shapeIndex, shapeXml] of shapeBlocks.entries()) {
        const paragraphs = Array.from(shapeXml.matchAll(/<(?:[\w.-]+:)?p\b[\s\S]*?<\/(?:[\w.-]+:)?p>/g))
          .map((match) => textFromXmlTextNodes(match[0]))
          .filter(Boolean);
        const text = (paragraphs.length ? paragraphs : [textFromXmlTextNodes(shapeXml)])
          .filter(Boolean)
          .join("\n");
        if (!text) {
          continue;
        }
        shapeCount += 1;
        const geometry = pptxShapeGeometry(shapeXml, slideNumber, shapeCount);
        if (geometry.bbox) {
          shapeGeometryCount += 1;
        }
        const shapeName = pptxShapeName(shapeXml, `shape-${shapeIndex + 1}`);
        const shape = pptxShapeMetadata(shapeXml, {
          fallbackName: shapeName,
          slideNumber,
          order: shapeCount
        });
        if (shape.isPlaceholder) {
          placeholderCount += 1;
        }
        if (shape.id || shape.name || shape.isPlaceholder) {
          shapeMetadataCount += 1;
        }
        const type = pptxShapeElementType(shape, shapeIndex);
        const level = pptxShapeHeadingLevel(shape, shapeIndex);
        pushStructureElement(elements, type, type === "heading" ? `Slide ${slideNumber}: ${text}` : text, {
          level,
          line: shapeCount,
          name: `${name}#${shapeName}`,
          page: slideNumber,
          bbox: geometry.bbox,
          layout: geometry.layout,
          shape
        });
        if (type !== "heading") {
          paragraphCount += Math.max(1, paragraphs.length);
        }
        hyperlinkCount += pushPptxLinkElements(elements, pptxHyperlinksFromXml(shapeXml, relationships, text), {
          name: `${name}#${shapeName}`,
          slideNumber,
          line: shapeCount,
          geometry,
          shape,
          linkStart: hyperlinkCount
        });
      }
    }
    if (tableFrames.length) {
      for (const frameXml of tableFrames) {
        tableCount += 1;
        const tableGeometry = pptxShapeGeometry(frameXml, slideNumber, shapeCount + tableCount);
        const table = appendPptxTableElements(elements, frameXml, {
          slideNumber,
          tableIndex: tableCount,
          order: shapeCount + tableCount
        });
        tableRowCount += table.rowCount;
        tableCellCount += table.cellCount;
        tableGeometryCount += table.geometryCount;
        hyperlinkCount += pushPptxLinkElements(elements, pptxHyperlinksFromXml(frameXml, relationships, textFromXmlTextNodes(frameXml)), {
          name: `${name}#table-${tableCount}`,
          slideNumber,
          line: shapeCount + tableCount,
          geometry: tableGeometry,
          shape: pptxShapeMetadata(frameXml, {
            fallbackName: pptxShapeName(frameXml, `Slide ${slideNumber} Table ${tableCount}`),
            slideNumber,
            order: shapeCount + tableCount
          }),
          linkStart: hyperlinkCount
        });
      }
    }
    if (chartFrames.length) {
      for (const frameXml of chartFrames) {
        const chartOrder = shapeCount + tableCount + imageCount + chartCount + 1;
        const chartGeometry = pptxShapeGeometry(frameXml, slideNumber, chartOrder);
        const chartShapeName = pptxShapeName(frameXml, `Slide ${slideNumber} Chart ${chartCount + 1}`);
        const chartShape = pptxShapeMetadata(frameXml, {
          fallbackName: chartShapeName,
          slideNumber,
          order: chartOrder
        });
        const chartLayout = chartGeometry.layout
          ? { ...chartGeometry.layout, strategy: "presentationml-chart-ref.v1" }
          : { strategy: "presentationml-chart-ref.v1", page: slideNumber, order: chartOrder };
        const charts = appendOfficeChartElements(elements, entries, frameXml, relationships, {
          sourcePart: name,
          format: "pptx",
          fallbackName: chartShapeName,
          page: slideNumber,
          lineStart: chartOrder,
          chartStart: chartCount,
          order: chartOrder,
          bbox: chartGeometry.bbox,
          layout: chartLayout,
          shape: chartShape
        });
        chartCount += charts.count;
        chartPartCount += charts.chartPartCount;
        chartSeriesCount += charts.chartSeriesCount;
        chartGeometryCount += charts.count && chartGeometry.bbox ? 1 : 0;
      }
    }
    if (pictureBlocks.length) {
      for (const pictureXml of pictureBlocks) {
        const image = appendPptxImageElements(elements, pictureXml, relationships, {
          slideNumber,
          imageIndex: imageCount + 1,
          order: shapeCount + tableCount + imageCount + 1,
          sourcePart: name
        });
        imageCount += image.count;
        imageGeometryCount += image.geometryCount;
      }
    }
    const comments = pptxCommentsForSlideEntries(entries, name, slideNumber, commentAuthors);
    for (const comment of comments) {
      commentCount += 1;
      pushStructureElement(elements, "comment", `Slide ${slideNumber} comment ${comment.id}${comment.author ? ` by ${comment.author}` : ""}: ${comment.text}`, {
        line: commentCount,
        name: `${comment.sourcePart}#comment-${comment.id || commentCount}`,
        page: slideNumber,
        layout: comment.layout,
        annotation: {
          kind: "presentation-comment",
          id: comment.id,
          ...(comment.author ? { author: comment.author } : {}),
          ...(comment.initials ? { initials: comment.initials } : {}),
          ...(comment.authorId ? { authorId: comment.authorId } : {}),
          ...(comment.date ? { date: comment.date } : {}),
          sourcePart: comment.sourcePart,
          relationshipId: comment.relationshipId,
          target: comment.target,
          type: comment.type
        },
        limit: 1800
      });
    }
    if (shapeBlocks.length || tableFrames.length || chartFrames.length || pictureBlocks.length) {
      continue;
    }
    const paragraphs = Array.from(xml.matchAll(/<(?:[\w.-]+:)?p\b[\s\S]*?<\/(?:[\w.-]+:)?p>/g))
      .map((match) => textFromXmlTextNodes(match[0]))
      .filter(Boolean);
    const fallback = textFromXmlTextNodes(xml);
    const slideText = paragraphs.length ? paragraphs : (fallback ? [fallback] : []);
    if (!slideText.length) {
      continue;
    }
    pushStructureElement(elements, "heading", `Slide ${slideNumber}: ${slideText[0]}`, {
      level: 1,
      line: slideNumber,
      name,
      page: slideNumber
    });
    for (const paragraph of slideText.slice(paragraphs.length ? 1 : 0)) {
      paragraphCount += 1;
      pushStructureElement(elements, "paragraph", paragraph, {
        line: paragraphCount,
        name,
        page: slideNumber
      });
    }
    hyperlinkCount += pushPptxLinkElements(elements, pptxHyperlinksFromXml(xml, relationships, slideText.join("\n")), {
      name,
      slideNumber,
      line: paragraphCount || slideNumber,
      linkStart: hyperlinkCount
    });
  }
  for (const [index, name] of noteNames.entries()) {
    const slideNumber = Number(name.match(/notesSlide(\d+)/)?.[1] || index + 1);
    const xml = zipEntryText(entries, name);
    const paragraphs = uniqueOrdered(Array.from(xml.matchAll(/<(?:[\w.-]+:)?p\b[\s\S]*?<\/(?:[\w.-]+:)?p>/g))
      .map((match) => compactMarkupText(textFromXmlTextNodes(match[0]), 1500))
      .filter(Boolean));
    const noteText = paragraphs.length
      ? paragraphs.join("\n")
      : compactMarkupText(textFromXmlTextNodes(xml), 2000);
    if (!noteText) {
      continue;
    }
    speakerNoteCount += 1;
    pushStructureElement(elements, "speaker-note", `Slide ${slideNumber} speaker notes: ${noteText}`, {
      line: speakerNoteCount,
      name,
      page: slideNumber,
      layout: {
        strategy: "presentationml-speaker-notes.v1",
        page: slideNumber,
        order: speakerNoteCount
      }
    });
  }
  const fallback = [
    ...slideNames
      .map((name, index) => `Slide ${Number(name.match(/slide(\d+)/)?.[1] || index + 1)}: ${textFromXmlTextNodes(zipEntryText(entries, name))}`)
      .filter((line) => !line.endsWith(": ")),
    ...noteNames
      .map((name, index) => {
        const noteText = compactMarkupText(textFromXmlTextNodes(zipEntryText(entries, name)), 2000);
        return noteText ? `Slide ${Number(name.match(/notesSlide(\d+)/)?.[1] || index + 1)} speaker notes: ${noteText}` : "";
      })
      .filter(Boolean)
  ].join("\n");
  const counts = elementTypeCounts(elements);
  return {
    text: structureElementsToText("pptx", elements, fallback),
    elements,
    format: "pptx",
    slideCount: slideNames.length,
    presentationPartCount: slideNames.length + slideLayoutNames.length + slideMasterNames.length + noteNames.length + commentPartNames.length + (commentAuthors.size ? 1 : 0),
    slideLayoutPartCount: slideLayoutNames.length || slideLayoutPartSet.size,
    slideMasterPartCount: slideMasterNames.length || slideMasterPartSet.size,
    slideLayoutRefCount,
    slideMasterRefCount,
    speakerNoteCount,
    commentCount,
    commentPartCount: commentPartNames.length,
    commentAuthorCount: commentAuthors.size,
    hyperlinkCount,
    imageCount,
    chartCount,
    chartPartCount,
    chartSeriesCount,
    placeholderCount,
    shapeMetadataCount,
    shapeCount,
    geometryCount: shapeGeometryCount + tableGeometryCount + imageGeometryCount + chartGeometryCount,
    shapeGeometryCount,
    imageGeometryCount,
    chartGeometryCount,
    tableCount,
    tableRowCount,
    tableCellCount,
    tableGeometryCount,
    paragraphCount,
    headingCount: counts.heading || 0
  };
}

function visioPartNumber(partName = "", pattern = /(\d+)/) {
  return Number(String(partName || "").match(pattern)?.[1] || 0);
}

function visioCellNumber(shapeXml = "", cellName = "") {
  for (const match of String(shapeXml || "").matchAll(/<[^:>]*:?Cell\b[^>]*(?:\/>|>[\s\S]*?<\/[^:>]*:?Cell>)/g)) {
    const tag = match[0].match(/^<[^>]+>/)?.[0] || match[0];
    if (xmlLocalAttribute(tag, "N").toLowerCase() !== String(cellName || "").toLowerCase()) {
      continue;
    }
    const value = Number(xmlLocalAttribute(tag, "V"));
    return Number.isFinite(value) ? roundLayoutNumber(value) : 0;
  }
  return 0;
}

function visioShapeGeometry(shapeXml = "", pageNumber = 0, order = 0) {
  const x = visioCellNumber(shapeXml, "PinX");
  const y = visioCellNumber(shapeXml, "PinY");
  const width = visioCellNumber(shapeXml, "Width");
  const height = visioCellNumber(shapeXml, "Height");
  if (![x, y, width, height].some((value) => value !== 0)) {
    return { bbox: null, layout: null };
  }
  const bbox = { x, y, width, height };
  return {
    bbox,
    layout: {
      strategy: "visio-shape-geometry.v1",
      page: pageNumber,
      order,
      x,
      y,
      width,
      height
    }
  };
}

function visioShapeText(shapeXml = "") {
  const blocks = [];
  for (const match of String(shapeXml || "").matchAll(/<[^:>]*:?Text\b[\s\S]*?<\/[^:>]*:?Text>/g)) {
    const text = compactMarkupText(textFromXmlTextNodes(match[0]) || stripMarkup(match[0]), 1800);
    if (text) {
      blocks.push(text);
    }
  }
  return uniqueOrdered(blocks).join("\n");
}

function visioShapeMetadata(openTag = "", {
  pageNumber = 0,
  order = 0
} = {}) {
  const id = xmlLocalAttribute(openTag, "ID") || xmlLocalAttribute(openTag, "Id");
  const name = xmlLocalAttribute(openTag, "NameU") || xmlLocalAttribute(openTag, "Name") || (id ? `Shape ${id}` : `Shape ${order}`);
  const type = xmlLocalAttribute(openTag, "Type");
  return Object.fromEntries(Object.entries({
    id,
    name,
    slide: Number(pageNumber || 0),
    order: Number(order || 0),
    type,
    master: xmlLocalAttribute(openTag, "Master"),
    masterShape: xmlLocalAttribute(openTag, "MasterShape")
  }).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

function parseVisio(entries = []) {
  const pageNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^visio\/pages\/page\d+\.xml$/.test(name))
    .sort((left, right) => visioPartNumber(left, /page(\d+)/) - visioPartNumber(right, /page(\d+)/));
  const masterNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^visio\/masters\/master\d+\.xml$/.test(name))
    .sort((left, right) => visioPartNumber(left, /master(\d+)/) - visioPartNumber(right, /master(\d+)/));
  const elements = [];
  let shapeCount = 0;
  let textShapeCount = 0;
  let connectorCount = 0;
  let geometryCount = 0;
  for (const [index, name] of pageNames.entries()) {
    const pageNumber = visioPartNumber(name, /page(\d+)/) || index + 1;
    const xml = zipEntryText(entries, name);
    for (const match of String(xml || "").matchAll(/<[^:>]*:?Shape\b[\s\S]*?<\/[^:>]*:?Shape>/g)) {
      const shapeXml = match[0];
      const openTag = shapeXml.match(/^<[^>]+>/)?.[0] || "";
      shapeCount += 1;
      const shape = visioShapeMetadata(openTag, { pageNumber, order: shapeCount });
      const text = visioShapeText(shapeXml);
      const geometry = visioShapeGeometry(shapeXml, pageNumber, shapeCount);
      if (geometry.bbox) {
        geometryCount += 1;
      }
      if (!text) {
        continue;
      }
      textShapeCount += 1;
      pushStructureElement(elements, "visio-shape", `Page ${pageNumber} ${shape.name || `Shape ${shapeCount}`}: ${text}`, {
        line: shapeCount,
        name: `${name}#shape-${shape.id || shapeCount}`,
        page: pageNumber,
        bbox: geometry.bbox,
        layout: geometry.layout,
        shape,
        limit: 2200
      });
    }
    for (const match of String(xml || "").matchAll(/<[^:>]*:?Connect\b[^>]*(?:\/>|>[\s\S]*?<\/[^:>]*:?Connect>)/g)) {
      const tag = match[0].match(/^<[^>]+>/)?.[0] || match[0];
      const from = xmlLocalAttribute(tag, "FromSheet");
      const to = xmlLocalAttribute(tag, "ToSheet");
      const fromPart = xmlLocalAttribute(tag, "FromPart");
      const toPart = xmlLocalAttribute(tag, "ToPart");
      connectorCount += 1;
      pushStructureElement(elements, "visio-connector", `Page ${pageNumber} connector ${from || "unknown"} -> ${to || "unknown"}${fromPart || toPart ? ` (${[fromPart, toPart].filter(Boolean).join(" to ")})` : ""}`, {
        line: connectorCount,
        name: `${name}#connector-${connectorCount}`,
        page: pageNumber,
        layout: {
          strategy: "visio-connector-ref.v1",
          page: pageNumber,
          order: connectorCount
        },
        shape: {
          id: [from, to].filter(Boolean).join("->") || `connector-${connectorCount}`,
          name: "Visio connector",
          slide: pageNumber,
          order: connectorCount
        },
        limit: 1200
      });
    }
  }
  const fallback = pageNames
    .map((name, index) => {
      const pageNumber = visioPartNumber(name, /page(\d+)/) || index + 1;
      const pageText = visioShapeText(zipEntryText(entries, name)) || textFromXmlTextNodes(zipEntryText(entries, name));
      return pageText ? `Page ${pageNumber}: ${pageText}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return {
    text: structureElementsToText("vsdx", elements, fallback),
    elements,
    format: "vsdx",
    pageCount: pageNames.length,
    visioPartCount: pageNames.length + masterNames.length + (zipEntryText(entries, "visio/document.xml") ? 1 : 0),
    shapeCount,
    textShapeCount,
    connectorCount,
    geometryCount
  };
}

function xmlAttribute(tag = "", name = "") {
  const pattern = new RegExp(`\\s${name}=(["'])(.*?)\\1`, "i");
  return decodeXmlEntities(String(tag || "").match(pattern)?.[2] || "");
}

function xlsxColumnLabel(cellRef = "", fallbackIndex = 0) {
  const label = String(cellRef || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (label) {
    return label;
  }
  let index = Math.max(0, Number(fallbackIndex) || 0);
  let output = "";
  do {
    output = String.fromCharCode(65 + (index % 26)) + output;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return output;
}

function xlsxColumnIndex(label = "") {
  let index = 0;
  for (const char of String(label || "").toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) {
      return -1;
    }
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function xlsxCellCoordinate(cellRef = "") {
  const match = String(cellRef || "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    return null;
  }
  return {
    column: match[1].toUpperCase(),
    columnIndex: xlsxColumnIndex(match[1]),
    row: Number(match[2])
  };
}

function xlsxCellRefsInRange(refRange = "", limit = 500) {
  const [startRef, endRef = startRef] = String(refRange || "").split(":").map((part) => part.trim().toUpperCase());
  const start = xlsxCellCoordinate(startRef);
  const end = xlsxCellCoordinate(endRef);
  if (!start || !end) {
    return startRef ? [startRef] : [];
  }
  const minColumn = Math.min(start.columnIndex, end.columnIndex);
  const maxColumn = Math.max(start.columnIndex, end.columnIndex);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const refs = [];
  for (let row = minRow; row <= maxRow && refs.length < limit; row += 1) {
    for (let column = minColumn; column <= maxColumn && refs.length < limit; column += 1) {
      refs.push(`${xlsxColumnLabel("", column)}${row}`);
    }
  }
  return refs;
}

function xlsxMergedCellRange(refRange = "") {
  const [rawStartRef, rawEndRef = rawStartRef] = String(refRange || "").split(":").map((part) => part.trim().toUpperCase());
  const start = xlsxCellCoordinate(rawStartRef);
  const end = xlsxCellCoordinate(rawEndRef);
  if (!start || !end) {
    return null;
  }
  const minColumn = Math.min(start.columnIndex, end.columnIndex);
  const maxColumn = Math.max(start.columnIndex, end.columnIndex);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const startRef = `${xlsxColumnLabel("", minColumn)}${minRow}`;
  const endRef = `${xlsxColumnLabel("", maxColumn)}${maxRow}`;
  const ref = startRef === endRef ? startRef : `${startRef}:${endRef}`;
  const cellRefs = xlsxCellRefsInRange(ref, 2000);
  return {
    ref,
    masterRef: startRef,
    startRef,
    endRef,
    startColumn: xlsxColumnLabel("", minColumn),
    endColumn: xlsxColumnLabel("", maxColumn),
    startColumnIndex: minColumn,
    endColumnIndex: maxColumn,
    startRow: minRow,
    endRow: maxRow,
    rowSpan: maxRow - minRow + 1,
    columnSpan: maxColumn - minColumn + 1,
    cellRefs
  };
}

function parseXlsxMergedCellsXml(xml = "") {
  const ranges = [];
  for (const match of String(xml || "").matchAll(/<mergeCell\b[^>]*(?:\/>|>)/g)) {
    const range = xlsxMergedCellRange(xmlAttribute(match[0], "ref"));
    if (range) {
      ranges.push(range);
    }
  }
  return ranges;
}

function xlsxMergedCellLookup(mergedCells = []) {
  const lookup = new Map();
  for (const range of mergedCells) {
    for (const ref of range.cellRefs || []) {
      lookup.set(String(ref || "").toUpperCase(), {
        ref: range.ref,
        masterRef: range.masterRef,
        startRef: range.startRef,
        endRef: range.endRef,
        rowSpan: range.rowSpan,
        columnSpan: range.columnSpan
      });
    }
  }
  return lookup;
}

function worksheetRelationshipEntryName(worksheetName = "") {
  const normalized = String(worksheetName || "").replace(/\\/g, "/");
  const directory = normalized.slice(0, normalized.lastIndexOf("/") + 1);
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return `${directory}_rels/${fileName}.rels`;
}

function worksheetRelationshipFilePath(sheetPath = "") {
  return path.join(path.dirname(sheetPath), "_rels", `${path.basename(sheetPath)}.rels`);
}

function parseXlsxRelationshipTargets(xml = "") {
  const relationships = new Map();
  for (const match of String(xml || "").matchAll(/<Relationship\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    const id = xmlAttribute(tag, "Id");
    const target = xmlAttribute(tag, "Target");
    if (!id || !target) {
      continue;
    }
    relationships.set(id, {
      id,
      target,
      targetMode: xmlAttribute(tag, "TargetMode"),
      type: xmlAttribute(tag, "Type")
    });
  }
  return relationships;
}

function parseXlsxHyperlinkTags(sheetXml = "", relationshipXml = "") {
  const relationships = parseXlsxRelationshipTargets(relationshipXml);
  const links = new Map();
  for (const match of String(sheetXml || "").matchAll(/<hyperlink\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    const refRange = xmlAttribute(tag, "ref");
    if (!refRange) {
      continue;
    }
    const relationship = relationships.get(xmlAttribute(tag, "r:id")) || null;
    const location = xmlAttribute(tag, "location");
    const target = relationship?.target || (location ? `#${location}` : "");
    const hyperlink = {
      ref: refRange,
      target,
      location,
      display: xmlAttribute(tag, "display"),
      tooltip: xmlAttribute(tag, "tooltip"),
      relationshipId: relationship?.id || "",
      targetMode: relationship?.targetMode || "",
      type: relationship?.type || ""
    };
    for (const ref of xlsxCellRefsInRange(refRange)) {
      links.set(ref.toUpperCase(), hyperlink);
    }
  }
  return links;
}

function xlsxCommentRelationships(relationshipXml = "", worksheetName = "") {
  const relationships = parseXlsxRelationshipTargets(relationshipXml);
  return [...relationships.values()]
    .filter((relationship) => (
      /\/comments$/i.test(relationship.type || "") ||
      /comments\d*\.xml$/i.test(relationship.target || "")
    ))
    .map((relationship) => ({
      ...relationship,
      target: normalizeXlsxPartTarget(worksheetName || "xl/worksheets/sheet1.xml", relationship.target)
    }));
}

function parseXlsxCommentsXml(xml = "", relationship = {}, sourcePart = "") {
  const authors = [];
  const authorsXml = String(xml || "").match(/<authors\b[\s\S]*?<\/authors>/i)?.[0] || "";
  for (const match of authorsXml.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/g)) {
    authors.push(stripMarkup(match[1]));
  }
  const comments = [];
  for (const match of String(xml || "").matchAll(/<comment\b[\s\S]*?<\/comment>/g)) {
    const commentXml = match[0];
    const openTag = commentXml.match(/^<comment\b[^>]*>/)?.[0] || "";
    const ref = xmlAttribute(openTag, "ref").toUpperCase();
    if (!ref) {
      continue;
    }
    const authorIdRaw = xmlAttribute(openTag, "authorId");
    const authorId = Number(authorIdRaw);
    const text = textFromXmlTextNodes(commentXml);
    if (!text) {
      continue;
    }
    comments.push({
      ref,
      authorId: Number.isInteger(authorId) ? authorId : -1,
      author: Number.isInteger(authorId) ? authors[authorId] || "" : "",
      text,
      relationshipId: String(relationship.id || ""),
      target: String(sourcePart || relationship.target || ""),
      sourcePart: String(sourcePart || relationship.target || ""),
      type: String(relationship.type || "")
    });
  }
  return comments;
}

function xlsxCommentsByRef(comments = []) {
  const byRef = new Map();
  for (const comment of comments) {
    if (comment.ref) {
      byRef.set(String(comment.ref || "").toUpperCase(), comment);
    }
  }
  return byRef;
}

function xlsxCommentsForWorksheetEntries(entries = [], worksheetName = "", relationshipXml = "", fallbackIndex = 0) {
  const relationships = xlsxCommentRelationships(relationshipXml, worksheetName);
  const commentParts = relationships.length
    ? relationships
    : [{
        id: "",
        target: normalizeXlsxPartTarget("xl/workbook.xml", `comments${fallbackIndex + 1}.xml`),
        targetMode: "",
        type: "fallback-comments-part"
      }];
  const comments = [];
  for (const relationship of commentParts) {
    const sourcePart = relationship.target || "";
    const xml = zipEntryText(entries, sourcePart);
    if (!xml) {
      continue;
    }
    comments.push(...parseXlsxCommentsXml(xml, relationship, sourcePart));
  }
  return comments;
}

function scanXmlTagsFromFile(filePath = "", tagName = "", onTag = () => {}) {
  if (!filePath || !fsSync.existsSync(filePath)) {
    return;
  }
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  const expression = new RegExp(`<${tagName}\\b[^>]*(?:\\/?>)`, "g");
  let input = null;
  let carry = "";
  try {
    input = fsSync.openSync(filePath, "r");
    while (true) {
      const bytesRead = fsSync.readSync(input, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      carry += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      expression.lastIndex = 0;
      let processed = 0;
      let match;
      while ((match = expression.exec(carry)) !== null) {
        onTag(match[0]);
        processed = expression.lastIndex;
      }
      if (processed > 0) {
        carry = carry.slice(processed);
      }
      if (carry.length > STREAM_TEXT_CHUNK_BYTES * 4) {
        carry = carry.slice(-STREAM_TEXT_CHUNK_BYTES);
      }
    }
    carry += decoder.decode();
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(carry)) !== null) {
      onTag(match[0]);
    }
  } finally {
    if (input !== null) {
      fsSync.closeSync(input);
    }
  }
}

function parseXlsxHyperlinksFile(sheetPath = "", relationshipPath = "") {
  const relationships = parseXlsxRelationshipTargets(
    relationshipPath && fsSync.existsSync(relationshipPath)
      ? fsSync.readFileSync(relationshipPath, "utf8")
      : ""
  );
  const links = new Map();
  scanXmlTagsFromFile(sheetPath, "hyperlink", (tag) => {
    const refRange = xmlAttribute(tag, "ref");
    if (!refRange) {
      return;
    }
    const relationship = relationships.get(xmlAttribute(tag, "r:id")) || null;
    const location = xmlAttribute(tag, "location");
    const target = relationship?.target || (location ? `#${location}` : "");
    const hyperlink = {
      ref: refRange,
      target,
      location,
      display: xmlAttribute(tag, "display"),
      tooltip: xmlAttribute(tag, "tooltip"),
      relationshipId: relationship?.id || "",
      targetMode: relationship?.targetMode || "",
      type: relationship?.type || ""
    };
    for (const ref of xlsxCellRefsInRange(refRange)) {
      links.set(ref.toUpperCase(), hyperlink);
    }
  });
  return links;
}

function parseSharedStringsXml(xml = "") {
  const strings = [];
  for (const match of String(xml || "").matchAll(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g)) {
    strings.push(textFromXmlTextNodes(match[0]));
  }
  return strings;
}

function parseWorkbookSheetNames(xml = "") {
  return parseWorkbookSheets(xml).map((sheet) => sheet.name).filter(Boolean);
}

function normalizeXlsxPartTarget(basePart = "xl/workbook.xml", target = "") {
  const raw = String(target || "").replace(/\\/g, "/").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("/")) {
    return path.posix.normalize(raw.slice(1)).replace(/^\.\//, "");
  }
  if (raw.startsWith("xl/")) {
    return path.posix.normalize(raw).replace(/^\.\//, "");
  }
  const baseDirectory = path.posix.dirname(String(basePart || "xl/workbook.xml").replace(/\\/g, "/"));
  return path.posix.normalize(path.posix.join(baseDirectory, raw)).replace(/^\.\//, "");
}

function parseWorkbookSheets(workbookXml = "", relationshipXml = "") {
  const relationships = parseXlsxRelationshipTargets(relationshipXml);
  const sheets = [];
  for (const [index, match] of Array.from(String(workbookXml || "").matchAll(/<sheet\b[^>]*>/g)).entries()) {
    const tag = match[0];
    const relationshipId = xmlAttribute(tag, "r:id");
    const relationship = relationships.get(relationshipId) || null;
    const fallbackTarget = `worksheets/sheet${index + 1}.xml`;
    sheets.push({
      position: index + 1,
      name: xmlAttribute(tag, "name") || `Sheet${index + 1}`,
      sheetId: xmlAttribute(tag, "sheetId"),
      relationshipId,
      state: xmlAttribute(tag, "state") || "visible",
      worksheetPath: normalizeXlsxPartTarget("xl/workbook.xml", relationship?.target || fallbackTarget),
      targetMode: relationship?.targetMode || "",
      relationshipType: relationship?.type || ""
    });
  }
  return sheets;
}

function xlsxDefinedNameBuiltinType(name = "") {
  const normalized = String(name || "").replace(/^_xlnm\./i, "").toLowerCase();
  if (normalized === "print_area") {
    return "print-area";
  }
  if (normalized === "print_titles") {
    return "print-titles";
  }
  if (normalized === "_filterdatabase" || normalized === "filterdatabase") {
    return "filter-database";
  }
  return "named-range";
}

function xlsxDefinedNameDisplayName(name = "") {
  return String(name || "").replace(/^_xlnm\./i, "");
}

function xlsxDefinedNameRanges(formula = "") {
  const ranges = [];
  const pattern = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/gi;
  for (const match of String(formula || "").matchAll(pattern)) {
    const sheetName = String(match[1] || match[2] || "").replace(/''/g, "'");
    const startRef = `${String(match[3] || "").toUpperCase()}${Number(match[4] || 0)}`;
    const endRef = match[5] && match[6]
      ? `${String(match[5] || "").toUpperCase()}${Number(match[6] || 0)}`
      : startRef;
    const range = xlsxMergedCellRange(startRef === endRef ? startRef : `${startRef}:${endRef}`);
    if (!range) {
      continue;
    }
    ranges.push({
      sheetName,
      ref: range.ref,
      startRef: range.startRef,
      endRef: range.endRef,
      startColumn: range.startColumn,
      endColumn: range.endColumn,
      startRow: range.startRow,
      endRow: range.endRow,
      rowSpan: range.rowSpan,
      columnSpan: range.columnSpan,
      cellRefs: range.cellRefs.slice(0, 200)
    });
  }
  return ranges;
}

function parseXlsxDefinedNamesXml(workbookXml = "", workbookSheets = []) {
  const sheetsByLocalId = new Map(workbookSheets.map((sheet, index) => [String(index), sheet]));
  const definedNames = [];
  for (const match of String(workbookXml || "").matchAll(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g)) {
    const xml = match[0];
    const tag = xml.match(/^<definedName\b[^>]*>/)?.[0] || "";
    const name = xmlAttribute(tag, "name");
    const formula = decodeXmlEntities(String(xml.match(/<definedName\b[^>]*>([\s\S]*?)<\/definedName>/)?.[1] || ""))
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!name || !formula) {
      continue;
    }
    const localSheetId = xmlAttribute(tag, "localSheetId");
    const sheet = localSheetId !== "" ? sheetsByLocalId.get(localSheetId) || null : null;
    const ranges = xlsxDefinedNameRanges(formula);
    const builtinType = xlsxDefinedNameBuiltinType(name);
    const sheetName = ranges[0]?.sheetName || sheet?.name || "";
    const ref = ranges.map((range) => range.sheetName ? `${range.sheetName}!${range.ref}` : range.ref).join(",");
    definedNames.push({
      kind: "spreadsheet-defined-name",
      name,
      displayName: xlsxDefinedNameDisplayName(name),
      builtin: name.startsWith("_xlnm.") || name.startsWith("_"),
      builtinType,
      scope: localSheetId !== "" ? "worksheet" : "workbook",
      localSheetId,
      hidden: xmlAttribute(tag, "hidden") === "1",
      sheetName,
      sheetId: String(sheet?.sheetId || ""),
      worksheetPath: String(sheet?.worksheetPath || ""),
      ref,
      formula,
      ranges,
      sourcePart: "xl/workbook.xml"
    });
  }
  return definedNames;
}

function formatXlsxDefinedNameLine(definedName = {}) {
  const typeLabel = definedName.builtinType === "print-area"
    ? "Print area"
    : definedName.builtinType === "print-titles"
      ? "Print titles"
      : definedName.builtinType === "filter-database"
        ? "Filter database"
        : "Named range";
  const name = definedName.displayName || definedName.name || typeLabel;
  const scope = definedName.sheetName ? ` (${definedName.sheetName})` : "";
  const target = definedName.ref || definedName.formula || "";
  return `${typeLabel} ${name}${scope}: ${target}`;
}

function appendXlsxDefinedNameElements(elements = [], definedNames = []) {
  for (const [index, definedName] of definedNames.entries()) {
    pushStructureElement(elements, "defined-name", formatXlsxDefinedNameLine(definedName), {
      line: index + 1,
      name: `xl/workbook.xml#defined-name-${index + 1}`,
      table: {
        format: "xlsx",
        sheet: definedName.sheetName || "",
        sheetName: definedName.sheetName || "",
        sheetId: definedName.sheetId || "",
        worksheetPath: definedName.worksheetPath || "",
        row: 0,
        columns: 0
      },
      definedName,
      limit: 1600
    });
  }
  return definedNames.length;
}

function workbookSheetRecordsForPaths(sheetPaths = [], workbookSheets = []) {
  const byPath = new Map(workbookSheets.map((sheet) => [sheet.worksheetPath, sheet]));
  const remaining = new Set(sheetPaths);
  const records = [];
  for (const sheet of workbookSheets) {
    if (!remaining.has(sheet.worksheetPath)) {
      continue;
    }
    records.push({ name: sheet.worksheetPath, sheet });
    remaining.delete(sheet.worksheetPath);
  }
  for (const name of sheetPaths) {
    if (!remaining.has(name)) {
      continue;
    }
    const index = records.length + 1;
    records.push({
      name,
      sheet: byPath.get(name) || {
        position: index,
        name: `Sheet${index}`,
        sheetId: "",
        relationshipId: "",
        state: "visible",
        worksheetPath: name,
        targetMode: "",
        relationshipType: ""
      }
    });
  }
  return records;
}

function xlsxSheetLabel(sheet = {}, fallbackIndex = 0) {
  const position = Number(sheet.position || fallbackIndex + 1 || 1);
  return `Sheet ${position}${sheet.name ? ` (${sheet.name})` : ""}`;
}

function xlsxTableMetadata(sheet = {}, sheetLabel = "", rowNumber = 0, columnCount = 0) {
  return {
    format: "xlsx",
    sheet: sheetLabel,
    sheetName: String(sheet.name || ""),
    sheetId: String(sheet.sheetId || ""),
    sheetState: String(sheet.state || "visible"),
    relationshipId: String(sheet.relationshipId || ""),
    worksheetPath: String(sheet.worksheetPath || ""),
    position: Number(sheet.position || 0),
    row: Number(rowNumber || 0),
    columns: Number(columnCount || 0)
  };
}

function xlsxWorksheetDrawingRelationshipIds(sheetXml = "") {
  return uniqueOrdered(Array.from(String(sheetXml || "").matchAll(/<[^:>]*:?drawing\b[^>]*(?:\/>|>)/g))
    .map((match) => xmlLocalAttribute(match[0], "id"))
    .filter(Boolean));
}

function appendXlsxChartElements(elements = [], entries = [], sheetXml = "", relationshipXml = "", {
  worksheetName = "",
  sheet = {},
  sheetLabel = "",
  chartStart = 0
} = {}) {
  const worksheetRelationships = parseXlsxRelationshipTargets(relationshipXml);
  let count = 0;
  let chartPartCount = 0;
  let chartSeriesCount = 0;
  const seenChartParts = new Set();
  for (const relationshipId of xlsxWorksheetDrawingRelationshipIds(sheetXml)) {
    const drawingRelationship = worksheetRelationships.get(relationshipId) || null;
    const drawingPart = officeRelationshipResolvedTarget(worksheetName, drawingRelationship);
    const drawingXml = drawingPart ? zipEntryText(entries, drawingPart) : "";
    if (!drawingXml) {
      continue;
    }
    const drawingRelationships = docxPartRelationships(entries, drawingPart);
    const charts = officeChartRefsFromXml(drawingXml, drawingRelationships, entries, {
      sourcePart: drawingPart,
      format: "xlsx",
      fallbackName: `${sheetLabel} Chart ${chartStart + count + 1}`,
      order: chartStart + count + 1,
      sheetName: String(sheet.name || ""),
      sheetId: String(sheet.sheetId || ""),
      worksheetPath: worksheetName
    });
    for (const chart of charts) {
      count += 1;
      if (chart.chartPart && !seenChartParts.has(chart.chartPart)) {
        chartPartCount += 1;
        seenChartParts.add(chart.chartPart);
      }
      chartSeriesCount += Number(chart.seriesCount || 0);
      pushStructureElement(elements, "chart", `${sheetLabel} ${chart.text}`, {
        line: chartStart + count,
        name: `${sheetLabel}#chart-${chartStart + count}`,
        href: chart.target || chart.chartPart,
        table: xlsxTableMetadata(sheet, sheetLabel, 0, 0),
        chart
      });
    }
  }
  return { count, chartPartCount, chartSeriesCount };
}

const XLSX_BUILTIN_DATE_NUMFMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58
]);

function xlsxNumberFormatLooksDate(formatCode = "") {
  const normalized = String(formatCode || "")
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\\./g, "")
    .replace(/_.?/g, "")
    .replace(/\*.?/g, "")
    .toLowerCase();
  return /(^|[^a-z])([ymd]{1,4}|h{1,2}:?m{0,2}|s{1,2})([^a-z]|$)/.test(normalized);
}

function parseXlsxStylesXml(xml = "") {
  const customFormats = new Map();
  for (const match of String(xml || "").matchAll(/<numFmt\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    const id = Number(xmlAttribute(tag, "numFmtId"));
    if (Number.isFinite(id)) {
      customFormats.set(id, xmlAttribute(tag, "formatCode"));
    }
  }
  const cellXfsXml = String(xml || "").match(/<cellXfs\b[\s\S]*?<\/cellXfs>/i)?.[0] || "";
  const cellXfs = [];
  for (const match of cellXfsXml.matchAll(/<xf\b[^>]*(?:\/>|>)/g)) {
    const tag = match[0];
    const numFmtId = Number(xmlAttribute(tag, "numFmtId") || 0);
    const formatCode = customFormats.get(numFmtId) || "";
    cellXfs.push({
      numFmtId,
      formatCode,
      isDate: XLSX_BUILTIN_DATE_NUMFMT_IDS.has(numFmtId) || xlsxNumberFormatLooksDate(formatCode)
    });
  }
  return {
    customFormatCount: customFormats.size,
    dateStyleCount: cellXfs.filter((style) => style.isDate).length,
    cellXfs
  };
}

function xlsxCellStyle(openTag = "", styles = null) {
  const styleIndexRaw = xmlAttribute(openTag, "s");
  if (styleIndexRaw === "") {
    return null;
  }
  const styleIndex = Number(styleIndexRaw);
  if (!Number.isInteger(styleIndex) || styleIndex < 0) {
    return null;
  }
  const style = styles?.cellXfs?.[styleIndex] || null;
  if (!style) {
    return { styleIndex };
  }
  return {
    styleIndex,
    numFmtId: style.numFmtId,
    formatCode: style.formatCode,
    isDate: Boolean(style.isDate)
  };
}

function xlsxCellValue(cellXml = "", sharedStrings = [], styles = null) {
  const openTag = String(cellXml || "").match(/^<c\b[^>]*>/)?.[0] || "";
  const type = xmlAttribute(openTag, "t");
  if (type === "inlineStr") {
    return { value: textFromXmlTextNodes(cellXml), rawValue: textFromXmlTextNodes(cellXml), style: xlsxCellStyle(openTag, styles), dateIso: "" };
  }
  const raw = decodeXmlEntities(String(cellXml || "").match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || "").trim();
  if (!raw) {
    return { value: "", rawValue: "", style: xlsxCellStyle(openTag, styles), dateIso: "" };
  }
  const style = xlsxCellStyle(openTag, styles);
  if (type === "s") {
    return { value: sharedStrings[Number(raw)] || raw, rawValue: raw, style, dateIso: "" };
  }
  if (type === "b") {
    return { value: raw === "1" ? "TRUE" : "FALSE", rawValue: raw, style, dateIso: "" };
  }
  const dateIso = style?.isDate ? isoDateFromExcelSerial(raw) : "";
  return {
    value: dateIso || raw,
    rawValue: raw,
    style,
    dateIso,
    dateSerial: dateIso ? raw : ""
  };
}

function xlsxCellFormula(cellXml = "") {
  const formulaTag = String(cellXml || "").match(/<f\b[^>]*(?:\/>|>)/)?.[0] || "";
  if (!formulaTag) {
    return null;
  }
  const formula = decodeXmlEntities(String(cellXml || "").match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] || "").trim();
  const formulaType = xmlAttribute(formulaTag, "t");
  const formulaRef = xmlAttribute(formulaTag, "ref");
  const sharedIndex = xmlAttribute(formulaTag, "si");
  return {
    formula,
    ...(formulaType ? { formulaType } : {}),
    ...(formulaRef ? { formulaRef } : {}),
    ...(sharedIndex ? { sharedIndex } : {})
  };
}

function parseXlsxRowXml(rowXml = "", sharedStrings = [], fallbackRowNumber = 0, hyperlinks = new Map(), styles = null, mergedCellsByRef = new Map(), commentsByRef = new Map()) {
  const rowOpenTag = String(rowXml || "").match(/^<row\b[^>]*>/)?.[0] || "";
  const rowNumber = Number(xmlAttribute(rowOpenTag, "r") || fallbackRowNumber || 0);
  const cells = [];
  let fallbackCellIndex = 0;
  for (const match of String(rowXml || "").matchAll(/<c\b[\s\S]*?<\/c>/g)) {
    const cellXml = match[0];
    const openTag = cellXml.match(/^<c\b[^>]*>/)?.[0] || "";
    const ref = xmlAttribute(openTag, "r") || `${xlsxColumnLabel("", fallbackCellIndex)}${rowNumber || ""}`;
    const column = xlsxColumnLabel(ref, fallbackCellIndex);
    const hyperlink = hyperlinks.get(String(ref || "").toUpperCase()) || null;
    const merge = mergedCellsByRef.get(String(ref || "").toUpperCase()) || null;
    const comment = commentsByRef.get(String(ref || "").toUpperCase()) || null;
    const valueRecord = xlsxCellValue(cellXml, sharedStrings, styles);
    const value = valueRecord.value || hyperlink?.display || "";
    const formula = xlsxCellFormula(cellXml);
    fallbackCellIndex += 1;
    if (value || formula || hyperlink || merge || comment) {
      cells.push({
        ref,
        column,
        value,
        ...(valueRecord.rawValue && valueRecord.rawValue !== value ? { rawValue: valueRecord.rawValue } : {}),
        ...(valueRecord.dateIso ? { dateIso: valueRecord.dateIso } : {}),
        ...(valueRecord.dateSerial ? { dateSerial: valueRecord.dateSerial } : {}),
        ...(valueRecord.style ? { style: valueRecord.style } : {}),
        ...(formula ? formula : {}),
        ...(hyperlink ? { hyperlink } : {}),
        ...(merge ? { merge } : {}),
        ...(comment ? { comment } : {})
      });
    }
  }
  return { rowNumber, cells };
}

function formatXlsxMerge(cell = {}) {
  return cell.merge?.ref ? ` (merge=${cell.merge.ref}${cell.merge.masterRef ? ` master=${cell.merge.masterRef}` : ""})` : "";
}

function formatXlsxComment(cell = {}) {
  if (!cell.comment?.text) {
    return "";
  }
  const author = cell.comment.author ? `${cell.comment.author}: ` : "";
  return ` (comment=${compactMarkupText(`${author}${cell.comment.text}`, 200)})`;
}

function formatXlsxHyperlink(cell = {}) {
  const target = cell.hyperlink?.target || cell.hyperlink?.location || "";
  return target ? ` (link=${target})` : "";
}

function formatXlsxCellValue(cell = {}, header = "") {
  const label = header ? `${cell.ref} ${header}` : cell.ref || cell.column;
  const value = cell.value ? `=${cell.value}` : "=<formula-only>";
  const formula = cell.formula ? ` (formula=${cell.formula})` : "";
  return `${label}${value}${formula}${formatXlsxHyperlink(cell)}${formatXlsxMerge(cell)}${formatXlsxComment(cell)}`;
}

function formatXlsxHeaderRow(sheetLabel = "", row = { cells: [] }) {
  const cells = row.cells.map((cell) => `${cell.column}=${cell.value || cell.formula || ""}${formatXlsxHyperlink(cell)}${formatXlsxMerge(cell)}${formatXlsxComment(cell)}`);
  return `${sheetLabel} Header row ${row.rowNumber || "?"}: ${cells.join("; ")}`;
}

function formatXlsxDataRow(sheetLabel = "", row = { cells: [] }, headersByColumn = new Map()) {
  const cells = row.cells.map((cell) => {
    const header = headersByColumn.get(cell.column);
    return formatXlsxCellValue(cell, header);
  });
  return `${sheetLabel} Row ${row.rowNumber || "?"}: ${cells.join("; ")}`;
}

function xlsxRowsToStructuredText(rows = [], sheetLabel = "") {
  const lines = [];
  const headersByColumn = new Map();
  let headerCaptured = false;
  for (const row of rows) {
    if (!row.cells.length) {
      continue;
    }
    if (!headerCaptured && row.cells.length >= 2) {
      for (const cell of row.cells) {
        headersByColumn.set(cell.column, cell.value);
      }
      lines.push(formatXlsxHeaderRow(sheetLabel, row));
      headerCaptured = true;
      continue;
    }
    lines.push(formatXlsxDataRow(sheetLabel, row, headersByColumn));
  }
  return lines.join("\n");
}

function xlsxElementCell(cell = {}, rowNumber = 0, header = "") {
  return {
    ref: cell.ref,
    column: cell.column,
    row: rowNumber,
    ...(header ? { header } : {}),
    value: cell.value,
    ...(cell.rawValue ? { rawValue: cell.rawValue } : {}),
    ...(cell.dateIso ? { dateIso: cell.dateIso } : {}),
    ...(cell.dateSerial ? { dateSerial: cell.dateSerial } : {}),
    ...(cell.style ? {
      style: {
        styleIndex: Number(cell.style.styleIndex || 0),
        numFmtId: Number(cell.style.numFmtId || 0),
        formatCode: String(cell.style.formatCode || ""),
        isDate: Boolean(cell.style.isDate)
      }
    } : {}),
    ...(cell.formula ? { formula: cell.formula } : {}),
    ...(cell.formulaType ? { formulaType: cell.formulaType } : {}),
    ...(cell.formulaRef ? { formulaRef: cell.formulaRef } : {}),
    ...(cell.sharedIndex ? { sharedIndex: cell.sharedIndex } : {}),
    ...(cell.merge ? {
      merge: {
        ref: String(cell.merge.ref || ""),
        masterRef: String(cell.merge.masterRef || ""),
        startRef: String(cell.merge.startRef || ""),
        endRef: String(cell.merge.endRef || ""),
        rowSpan: Number(cell.merge.rowSpan || 0),
        columnSpan: Number(cell.merge.columnSpan || 0)
      }
    } : {}),
    ...(cell.comment ? {
      comment: {
        ref: String(cell.comment.ref || cell.ref || ""),
        author: String(cell.comment.author || ""),
        authorId: Number(cell.comment.authorId || 0),
        text: String(cell.comment.text || ""),
        relationshipId: String(cell.comment.relationshipId || ""),
        target: String(cell.comment.target || ""),
        sourcePart: String(cell.comment.sourcePart || ""),
        type: String(cell.comment.type || "")
      }
    } : {}),
    ...(cell.hyperlink ? {
      hyperlink: {
        target: String(cell.hyperlink.target || ""),
        location: String(cell.hyperlink.location || ""),
        display: String(cell.hyperlink.display || ""),
        tooltip: String(cell.hyperlink.tooltip || ""),
        relationshipId: String(cell.hyperlink.relationshipId || ""),
        targetMode: String(cell.hyperlink.targetMode || "")
      }
    } : {})
  };
}

function xlsxElementMerge(range = {}, anchorValue = "") {
  return {
    ref: String(range.ref || ""),
    masterRef: String(range.masterRef || range.startRef || ""),
    startRef: String(range.startRef || ""),
    endRef: String(range.endRef || ""),
    startColumn: String(range.startColumn || ""),
    endColumn: String(range.endColumn || ""),
    startRow: Number(range.startRow || 0),
    endRow: Number(range.endRow || 0),
    rowSpan: Number(range.rowSpan || 0),
    columnSpan: Number(range.columnSpan || 0),
    cellRefs: Array.isArray(range.cellRefs) ? range.cellRefs.slice(0, 200) : [],
    anchorValue: String(anchorValue || "")
  };
}

function parseXlsxDetailed(entries = []) {
  const sharedStrings = parseSharedStringsXml(zipEntryText(entries, "xl/sharedStrings.xml"));
  const styles = parseXlsxStylesXml(zipEntryText(entries, "xl/styles.xml"));
  const workbookXml = zipEntryText(entries, "xl/workbook.xml");
  const workbookSheets = parseWorkbookSheets(
    workbookXml,
    zipEntryText(entries, "xl/_rels/workbook.xml.rels")
  );
  const definedNames = parseXlsxDefinedNamesXml(workbookXml, workbookSheets);
  const sheetNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/sheet(\d+)/)?.[1] || 0) - Number(right.match(/sheet(\d+)/)?.[1] || 0));
  const sheetRecords = workbookSheetRecordsForPaths(sheetNames, workbookSheets);
  const lines = [];
  let rowCount = 0;
  let cellCount = 0;
  let formulaCount = 0;
  let hyperlinkCount = 0;
  let dateCellCount = 0;
  let mergedCellCount = 0;
  let commentCount = 0;
  let headerRows = 0;
  let chartCount = 0;
  let chartPartCount = 0;
  let chartSeriesCount = 0;
  const elements = [];
  appendXlsxDefinedNameElements(elements, definedNames);
  for (const [index, record] of sheetRecords.entries()) {
    const { name, sheet } = record;
    const sheetXml = zipEntryText(entries, name);
    const relationshipXml = zipEntryText(entries, worksheetRelationshipEntryName(name));
    const sheetLabel = xlsxSheetLabel(sheet, index);
    const hyperlinks = parseXlsxHyperlinkTags(
      sheetXml,
      relationshipXml
    );
    const mergedCells = parseXlsxMergedCellsXml(sheetXml);
    const mergedCellsByRef = xlsxMergedCellLookup(mergedCells);
    const comments = xlsxCommentsForWorksheetEntries(entries, name, relationshipXml, index);
    const commentsByRef = xlsxCommentsByRef(comments);
    mergedCellCount += mergedCells.length;
    commentCount += comments.length;
    const rows = [];
    for (const match of sheetXml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
      const row = parseXlsxRowXml(match[0], sharedStrings, rows.length + 1, hyperlinks, styles, mergedCellsByRef, commentsByRef);
      if (row.cells.length) {
        rows.push(row);
        rowCount += 1;
        cellCount += row.cells.length;
        formulaCount += row.cells.filter((cell) => cell.formula).length;
        hyperlinkCount += row.cells.filter((cell) => cell.hyperlink).length;
        dateCellCount += row.cells.filter((cell) => cell.dateIso).length;
      }
    }
    const text = xlsxRowsToStructuredText(rows, sheetLabel);
    if (text) {
      headerRows += 1;
      lines.push(text);
    }
    const headersByColumn = new Map();
    let headerCaptured = false;
    const cellsByRef = new Map(rows.flatMap((row) => (
      row.cells.map((cell) => [String(cell.ref || "").toUpperCase(), cell])
    )));
    for (const range of mergedCells) {
      const anchorCell = cellsByRef.get(String(range.masterRef || range.startRef || "").toUpperCase()) || null;
      const anchorValue = anchorCell?.value || anchorCell?.formula || "";
      pushStructureElement(elements, "merged-cell", `${sheetLabel} Merged range ${range.ref}: ${range.masterRef}${anchorValue ? `=${anchorValue}` : ""} spans ${range.rowSpan}x${range.columnSpan}`, {
        line: range.startRow,
        name: sheetLabel,
        table: xlsxTableMetadata(sheet, sheetLabel, range.startRow, range.columnSpan),
        merge: xlsxElementMerge(range, anchorValue),
        limit: 1200
      });
    }
    for (const comment of comments) {
      const coordinate = xlsxCellCoordinate(comment.ref);
      const anchorCell = cellsByRef.get(String(comment.ref || "").toUpperCase()) || {
        ref: comment.ref,
        column: coordinate?.column || xlsxColumnLabel(comment.ref),
        value: "",
        comment
      };
      const cell = { ...anchorCell, comment };
      pushStructureElement(elements, "cell-comment", `${sheetLabel} Comment ${comment.ref}${comment.author ? ` by ${comment.author}` : ""}: ${comment.text}`, {
        line: coordinate?.row || 0,
        name: sheetLabel,
        table: xlsxTableMetadata(sheet, sheetLabel, coordinate?.row || 0, 1),
        annotation: {
          kind: "spreadsheet-comment",
          id: comment.ref,
          author: comment.author || "",
          type: "comment",
          sourcePart: comment.sourcePart || ""
        },
        cells: [xlsxElementCell(cell, coordinate?.row || 0)],
        limit: 1600
      });
    }
    for (const row of rows) {
      if (!row.cells.length) {
        continue;
      }
      if (!headerCaptured && row.cells.length >= 2) {
        for (const cell of row.cells) {
          headersByColumn.set(cell.column, cell.value);
        }
        pushStructureElement(elements, "table-header", formatXlsxHeaderRow(sheetLabel, row), {
          line: row.rowNumber,
          name: sheetLabel,
          table: xlsxTableMetadata(sheet, sheetLabel, row.rowNumber, row.cells.length),
          cells: row.cells.map((cell) => xlsxElementCell(cell, row.rowNumber)),
          limit: 2000
        });
        headerCaptured = true;
        continue;
      }
      pushStructureElement(elements, "table-row", formatXlsxDataRow(sheetLabel, row, headersByColumn), {
        line: row.rowNumber,
        name: sheetLabel,
        table: xlsxTableMetadata(sheet, sheetLabel, row.rowNumber, row.cells.length),
        cells: row.cells.map((cell) => xlsxElementCell(cell, row.rowNumber, headersByColumn.get(cell.column) || "")),
        limit: 2000
      });
    }
    const charts = appendXlsxChartElements(elements, entries, sheetXml, relationshipXml, {
      worksheetName: name,
      sheet,
      sheetLabel,
      chartStart: chartCount
    });
    chartCount += charts.count;
    chartPartCount += charts.chartPartCount;
    chartSeriesCount += charts.chartSeriesCount;
  }
  return {
    text: structureElementsToText("xlsx", elements, lines.join("\n")),
    elements,
    format: "xlsx",
    sharedStringCount: sharedStrings.length,
    dateStyleCount: styles.dateStyleCount,
    dateCellCount,
    mergedCellCount,
    commentCount,
    definedNameCount: definedNames.length,
    namedRangeCount: definedNames.filter((definedName) => definedName.builtinType === "named-range").length,
    printAreaCount: definedNames.filter((definedName) => definedName.builtinType === "print-area").length,
    sheetCount: sheetNames.length,
    workbookSheetCount: workbookSheets.length,
    sheetRefCount: sheetRecords.filter((record) => (
      record.sheet?.sheetId || record.sheet?.relationshipId || record.sheet?.worksheetPath || record.sheet?.name
    )).length,
    hiddenSheetCount: sheetRecords.filter((record) => record.sheet?.state && record.sheet.state !== "visible").length,
    rowCount,
    cellCount,
    formulaCount,
    hyperlinkCount,
    chartCount,
    chartPartCount,
    chartSeriesCount,
    headerRows
  };
}

function parseXlsx(entries = []) {
  return parseXlsxDetailed(entries).text;
}

function removeOpenDocumentTables(xml = "") {
  return String(xml || "").replace(/<(?:[\w.-]+:)?table(?:\s|>)[\s\S]*?<\/(?:[\w.-]+:)?table>/g, " ");
}

function openDocumentRepeatedCount(tag = "", localName = "number-columns-repeated") {
  const value = Number(xmlLocalAttribute(tag, localName) || 1);
  return Number.isFinite(value) && value > 0 ? Math.min(1000, Math.floor(value)) : 1;
}

function openDocumentTableCells(rowXml = "") {
  const cells = [];
  for (const match of String(rowXml || "").matchAll(/<[^:>]*:?table-cell\b[\s\S]*?<\/[^:>]*:?table-cell>/g)) {
    const cellXml = match[0];
    const tag = cellXml.match(/^<[^>]+>/)?.[0] || "";
    const repeat = openDocumentRepeatedCount(tag, "number-columns-repeated");
    const text = compactMarkupText(textFromXmlTextNodes(cellXml), 1000);
    for (let index = 0; index < repeat; index += 1) {
      cells.push(text);
    }
  }
  return cells;
}

function appendOpenDocumentTableElements(elements = [], tableXml = "", { name = "", tableIndex = 0, lineStart = 0 } = {}) {
  const tableTag = String(tableXml || "").match(/^<[^>]+>/)?.[0] || "";
  const tableLabel = xmlLocalAttribute(tableTag, "name") || `Table ${tableIndex}`;
  const rows = [];
  for (const match of String(tableXml || "").matchAll(/<[^:>]*:?table-row\b[\s\S]*?<\/[^:>]*:?table-row>/g)) {
    const rowXml = match[0];
    const tag = rowXml.match(/^<[^>]+>/)?.[0] || "";
    const repeat = openDocumentRepeatedCount(tag, "number-rows-repeated");
    const cells = openDocumentTableCells(rowXml);
    if (!cells.some(Boolean)) {
      continue;
    }
    for (let index = 0; index < repeat; index += 1) {
      rows.push(cells);
    }
  }
  if (!rows.length) {
    return { rowCount: 0, cellCount: 0 };
  }
  const headers = rows[0];
  let cellCount = 0;
  for (const [rowIndex, cells] of rows.entries()) {
    const rowNumber = rowIndex + 1;
    cellCount += cells.length;
    const type = rowIndex === 0 ? "table-header" : "table-row";
    const text = rowIndex === 0
      ? `${tableLabel} Header row ${rowNumber}: ${cells.map((cell, cellIndex) => `${xlsxColumnLabel("", cellIndex)}=${cell}`).join("; ")}`
      : `${tableLabel} Row ${rowNumber}: ${cells.map((cell, cellIndex) => `${headers[cellIndex] || `Column ${cellIndex + 1}`}=${cell}`).join("; ")}`;
    pushStructureElement(elements, type, text, {
      line: lineStart + rowNumber,
      name: `${name}#table-${tableIndex}`,
      table: {
        format: "open-document",
        sheet: tableLabel,
        row: rowNumber,
        columns: cells.length
      },
      cells: cells.map((cell, cellIndex) => ({
        ref: `${xlsxColumnLabel("", cellIndex)}${rowNumber}`,
        column: xlsxColumnLabel("", cellIndex),
        row: rowNumber,
        header: rowIndex === 0 ? "" : headers[cellIndex] || "",
        value: cell
      }))
    });
  }
  return { rowCount: rows.length, cellCount };
}

function appendOpenDocumentLinkElements(elements = [], xml = "", { name = "", lineStart = 0 } = {}) {
  let count = 0;
  for (const match of String(xml || "").matchAll(/<[^:>]*:?a\b[^>]*>[\s\S]*?<\/[^:>]*:?a>/g)) {
    const linkXml = match[0];
    const tag = linkXml.match(/^<[^>]+>/)?.[0] || "";
    const href = xmlLocalAttribute(tag, "href");
    const text = compactMarkupText(textFromXmlTextNodes(linkXml), 1200);
    if (!href || !text) {
      continue;
    }
    count += 1;
    pushStructureElement(elements, "link", text, {
      line: lineStart + count,
      name: `${name}#link-${count}`,
      href
    });
  }
  return count;
}

function parseOpenDocument(entries = []) {
  const contentNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^(content|styles|meta)\.xml$/.test(name));
  const elements = [];
  let sequence = 0;
  let tableCount = 0;
  let tableRowCount = 0;
  let tableCellCount = 0;
  let linkCount = 0;
  for (const name of contentNames) {
    const xml = zipEntryText(entries, name);
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?table(?:\s|>)[\s\S]*?<\/(?:[\w.-]+:)?table>/g)) {
      tableCount += 1;
      const table = appendOpenDocumentTableElements(elements, match[0], {
        name,
        tableIndex: tableCount,
        lineStart: sequence + tableRowCount
      });
      tableRowCount += table.rowCount;
      tableCellCount += table.cellCount;
    }
    const nonTableXml = removeOpenDocumentTables(xml);
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?h\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?h>/g)) {
      const tag = match[0].match(/^<[^>]+>/)?.[0] || "";
      const level = Number(xmlLocalAttribute(tag, "outline-level") || 1);
      sequence += 1;
      pushStructureElement(elements, "heading", textFromXmlTextNodes(match[0]), {
        level: Math.max(1, Math.min(8, level || 1)),
        line: sequence,
        name
      });
    }
    for (const match of nonTableXml.matchAll(/<(?:[\w.-]+:)?p\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?p>/g)) {
      sequence += 1;
      pushStructureElement(elements, "paragraph", textFromXmlTextNodes(match[0]), { line: sequence, name });
    }
    linkCount += appendOpenDocumentLinkElements(elements, xml, {
      name,
      lineStart: sequence + tableRowCount + linkCount
    });
  }
  const fallback = contentNames
    .map((name) => textFromXmlTextNodes(zipEntryText(entries, name)))
    .filter(Boolean)
    .join("\n\n");
  const counts = elementTypeCounts(elements);
  return {
    text: structureElementsToText("open-document", elements, fallback),
    elements,
    format: "open-document",
    xmlFileCount: contentNames.length,
    headingCount: counts.heading || 0,
    paragraphCount: counts.paragraph || 0,
    tableCount,
    tableRowCount,
    tableCellCount,
    linkCount
  };
}

function parseEpub(entries = []) {
  const chapterNames = entries
    .map((entry) => entry.name)
    .filter((name) => /\.(xhtml|html|htm|xml)$/i.test(name))
    .filter((name) => !/(^|\/)(container|package|toc|nav)\.(xml|xhtml|html)$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  const elements = [];
  const fallback = [];
  for (const [index, name] of chapterNames.slice(0, 500).entries()) {
    const xml = zipEntryText(entries, name);
    const chapterElements = parseHtmlMarkupElements(xml);
    const text = stripMarkup(xml);
    if (text) {
      fallback.push(`Chapter ${index + 1} (${name}): ${text}`);
    }
    if (!chapterElements.some((element) => isHeadingStructureElement(element))) {
      pushStructureElement(elements, "heading", `Chapter ${index + 1}: ${name}`, {
        level: 1,
        line: index + 1,
        name
      });
    }
    for (const element of chapterElements) {
      pushStructureElement(elements, element.type, element.text, {
        level: element.level,
        line: element.line || index + 1,
        href: element.href,
        name
      });
    }
  }
  const counts = elementTypeCounts(elements);
  return {
    text: structureElementsToText("epub", elements, fallback.join("\n\n")),
    elements,
    format: "epub",
    chapterCount: chapterNames.length,
    headingCount: (counts.title || 0) + (counts.heading || 0),
    paragraphCount: counts.paragraph || 0,
    tableRowCount: counts["table-row"] || 0,
    linkCount: counts.link || 0
  };
}

function collectFiles(rootDir = "", predicate = () => false, limit = 1000) {
  const files = [];
  const walk = (dir) => {
    if (files.length >= limit) {
      return;
    }
    for (const item of fsSync.readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= limit) {
        return;
      }
      const absolutePath = path.join(dir, item.name);
      const relativePath = safeRelativeArchivePath(path.relative(rootDir, absolutePath));
      if (item.isDirectory()) {
        walk(absolutePath);
      } else if (item.isFile() && predicate(relativePath, absolutePath)) {
        files.push({ absolutePath, relativePath });
      }
    }
  };
  if (rootDir && fsSync.existsSync(rootDir)) {
    walk(rootDir);
  }
  return files;
}

function streamingMarkupToText(chunk = "", final = false) {
  const text = String(chunk || "");
  if (!text) {
    return { output: "", carry: "" };
  }
  if (!final && text.length <= 8192) {
    return { output: "", carry: text };
  }
  const splitAt = final ? text.length : Math.max(0, text.length - 8192);
  const head = text.slice(0, splitAt);
  const carry = final ? "" : text.slice(splitAt);
  const output = textFromXmlTextNodes(head)
    .replace(/\s+/g, " ")
    .trim();
  return { output, carry };
}

function appendMarkupFileAsText(inputPath = "", outputPath = "") {
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  let input = null;
  let totalCharacters = 0;
  let carry = "";
  try {
    input = fsSync.openSync(inputPath, "r");
    while (true) {
      const bytesRead = fsSync.readSync(input, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      const decoded = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      const transformed = streamingMarkupToText(carry + decoded, false);
      carry = transformed.carry;
      if (transformed.output) {
        const block = `${transformed.output}\n`;
        fsSync.appendFileSync(outputPath, block, "utf8");
        totalCharacters += block.length;
      }
    }
    const tail = decoder.decode();
    const transformed = streamingMarkupToText(carry + tail, true);
    if (transformed.output) {
      const block = `${transformed.output}\n`;
      fsSync.appendFileSync(outputPath, block, "utf8");
      totalCharacters += block.length;
    }
  } finally {
    if (input !== null) {
      fsSync.closeSync(input);
    }
  }
  return totalCharacters;
}

function scanXmlElementsFromFile(filePath = "", tagName = "", onElement = () => {}) {
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  const expression = new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, "g");
  let input = null;
  let carry = "";
  try {
    input = fsSync.openSync(filePath, "r");
    while (true) {
      const bytesRead = fsSync.readSync(input, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      carry += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      expression.lastIndex = 0;
      let processed = 0;
      let match;
      while ((match = expression.exec(carry)) !== null) {
        onElement(match[0]);
        processed = expression.lastIndex;
      }
      if (processed > 0) {
        carry = carry.slice(processed);
      }
      if (carry.length > STREAM_TEXT_CHUNK_BYTES * 4) {
        carry = carry.slice(-STREAM_TEXT_CHUNK_BYTES);
      }
    }
    carry += decoder.decode();
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(carry)) !== null) {
      onElement(match[0]);
    }
  } finally {
    if (input !== null) {
      fsSync.closeSync(input);
    }
  }
}

function scanXmlOpenTagsFromFile(filePath = "", tagName = "", onTag = () => {}) {
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  const expression = new RegExp(`<${tagName}\\b[^>]*(?:\\/?>)`, "g");
  let input = null;
  let carry = "";
  try {
    input = fsSync.openSync(filePath, "r");
    while (true) {
      const bytesRead = fsSync.readSync(input, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      carry += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      expression.lastIndex = 0;
      let processed = 0;
      let match;
      while ((match = expression.exec(carry)) !== null) {
        onTag(match[0]);
        processed = expression.lastIndex;
      }
      if (processed > 0) {
        carry = carry.slice(processed);
      }
      if (carry.length > STREAM_TEXT_CHUNK_BYTES * 4) {
        carry = carry.slice(-STREAM_TEXT_CHUNK_BYTES);
      }
    }
    carry += decoder.decode();
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(carry)) !== null) {
      onTag(match[0]);
    }
  } finally {
    if (input !== null) {
      fsSync.closeSync(input);
    }
  }
}

function parseSharedStringsFile(filePath = "") {
  const strings = [];
  if (!filePath || !fsSync.existsSync(filePath)) {
    return strings;
  }
  scanXmlElementsFromFile(filePath, "si", (xml) => {
    strings.push(textFromXmlTextNodes(xml));
  });
  return strings;
}

function parseXlsxStylesFile(filePath = "") {
  return parseXlsxStylesXml(
    filePath && fsSync.existsSync(filePath)
      ? fsSync.readFileSync(filePath, "utf8")
      : ""
  );
}

function parseXlsxMergedCellsFile(filePath = "") {
  const ranges = [];
  if (!filePath || !fsSync.existsSync(filePath)) {
    return ranges;
  }
  scanXmlOpenTagsFromFile(filePath, "mergeCell", (tag) => {
    const range = xlsxMergedCellRange(xmlAttribute(tag, "ref"));
    if (range) {
      ranges.push(range);
    }
  });
  return ranges;
}

function xlsxPackageRootFromPartFile(filePath = "") {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const marker = "/xl/";
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(0, index + 1) : path.dirname(path.dirname(filePath));
}

function xlsxRelationshipTargetFilePath(baseFilePath = "", target = "") {
  const raw = String(target || "").replace(/\\/g, "/").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("/")) {
    return path.join(xlsxPackageRootFromPartFile(baseFilePath), raw.slice(1));
  }
  if (raw.startsWith("xl/")) {
    return path.join(xlsxPackageRootFromPartFile(baseFilePath), raw);
  }
  return path.resolve(path.dirname(baseFilePath), raw);
}

function parseXlsxCommentsFile(commentsPath = "", relationship = {}) {
  if (!commentsPath || !fsSync.existsSync(commentsPath)) {
    return [];
  }
  return parseXlsxCommentsXml(fsSync.readFileSync(commentsPath, "utf8"), relationship, normalizeXlsxPartTarget("xl/workbook.xml", relationship.target || ""));
}

function parseXlsxCommentsForSheetFile(sheetPath = "", relationshipPath = "", fallbackIndex = 0) {
  const relationshipXml = relationshipPath && fsSync.existsSync(relationshipPath)
    ? fsSync.readFileSync(relationshipPath, "utf8")
    : "";
  const relationships = xlsxCommentRelationships(relationshipXml, "xl/worksheets/sheet1.xml");
  const commentParts = relationships.length
    ? relationships
    : [{
        id: "",
        target: `xl/comments${fallbackIndex + 1}.xml`,
        targetMode: "",
        type: "fallback-comments-part"
      }];
  return commentParts.flatMap((relationship) => parseXlsxCommentsFile(
    xlsxRelationshipTargetFilePath(sheetPath, relationship.target),
    relationship
  ));
}

function appendXlsxWorksheetText({ sheetPath = "", sheetLabel = "", sharedStrings = [], styles = null, outputPath = "", fallbackIndex = 0 } = {}) {
  const hyperlinks = parseXlsxHyperlinksFile(sheetPath, worksheetRelationshipFilePath(sheetPath));
  const mergedCells = parseXlsxMergedCellsFile(sheetPath);
  const mergedCellsByRef = xlsxMergedCellLookup(mergedCells);
  const comments = parseXlsxCommentsForSheetFile(sheetPath, worksheetRelationshipFilePath(sheetPath), fallbackIndex);
  const commentsByRef = xlsxCommentsByRef(comments);
  const headersByColumn = new Map();
  let headerCaptured = false;
  let rowCount = 0;
  let cellCount = 0;
  let formulaCount = 0;
  let hyperlinkCount = 0;
  let dateCellCount = 0;
  let mergedCellCount = 0;
  let commentCount = 0;
  let headerRows = 0;
  let totalCharacters = 0;
  const appendLine = (line = "") => {
    const text = `${line}\n`;
    fsSync.appendFileSync(outputPath, text, "utf8");
    totalCharacters += text.length;
  };
  scanXmlElementsFromFile(sheetPath, "row", (xml) => {
    const row = parseXlsxRowXml(xml, sharedStrings, rowCount + 1, hyperlinks, styles, mergedCellsByRef, commentsByRef);
    if (!row.cells.length) {
      return;
    }
    rowCount += 1;
    cellCount += row.cells.length;
    formulaCount += row.cells.filter((cell) => cell.formula).length;
    hyperlinkCount += row.cells.filter((cell) => cell.hyperlink).length;
    dateCellCount += row.cells.filter((cell) => cell.dateIso).length;
    if (!headerCaptured && row.cells.length >= 2) {
      for (const cell of row.cells) {
        headersByColumn.set(cell.column, cell.value);
      }
      appendLine(formatXlsxHeaderRow(sheetLabel, row));
      headerRows += 1;
      headerCaptured = true;
      return;
    }
    appendLine(formatXlsxDataRow(sheetLabel, row, headersByColumn));
  });
  for (const range of mergedCells) {
    appendLine(`${sheetLabel} Merged range ${range.ref}: ${range.masterRef} spans ${range.rowSpan}x${range.columnSpan}`);
  }
  for (const comment of comments) {
    appendLine(`${sheetLabel} Comment ${comment.ref}${comment.author ? ` by ${comment.author}` : ""}: ${comment.text}`);
    commentCount += 1;
  }
  return { rowCount, cellCount, formulaCount, hyperlinkCount, dateCellCount, mergedCellCount: mergedCells.length, commentCount, headerRows, totalCharacters };
}

function appendXlsxDirectoryAsText(rootDir = "", outputPath = "") {
  const sharedStrings = parseSharedStringsFile(path.join(rootDir, "xl/sharedStrings.xml"));
  const styles = parseXlsxStylesFile(path.join(rootDir, "xl/styles.xml"));
  const workbookXml = fsSync.existsSync(path.join(rootDir, "xl/workbook.xml"))
    ? fsSync.readFileSync(path.join(rootDir, "xl/workbook.xml"), "utf8")
    : "";
  const workbookSheets = parseWorkbookSheets(
    workbookXml,
    fsSync.existsSync(path.join(rootDir, "xl/_rels/workbook.xml.rels"))
      ? fsSync.readFileSync(path.join(rootDir, "xl/_rels/workbook.xml.rels"), "utf8")
      : ""
  );
  const definedNames = parseXlsxDefinedNamesXml(workbookXml, workbookSheets);
  const sheetFiles = collectFiles(rootDir, (name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name), 1000)
    .sort((left, right) => Number(left.relativePath.match(/sheet(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/sheet(\d+)/)?.[1] || 0));
  const filesByRelativePath = new Map(sheetFiles.map((file) => [file.relativePath, file]));
  const sheetRecords = workbookSheetRecordsForPaths(sheetFiles.map((file) => file.relativePath), workbookSheets)
    .map((record) => ({ ...record, file: filesByRelativePath.get(record.name) }))
    .filter((record) => record.file);
  let totalCharacters = 0;
  let rowCount = 0;
  let cellCount = 0;
  let formulaCount = 0;
  let hyperlinkCount = 0;
  let dateCellCount = 0;
  let mergedCellCount = 0;
  let commentCount = 0;
  let headerRows = 0;
  for (const definedName of definedNames) {
    const line = `${formatXlsxDefinedNameLine(definedName)}\n`;
    fsSync.appendFileSync(outputPath, line, "utf8");
    totalCharacters += line.length;
  }
  for (const [index, record] of sheetRecords.entries()) {
    const sheetLabel = xlsxSheetLabel(record.sheet, index);
    const stats = appendXlsxWorksheetText({
      sheetPath: record.file.absolutePath,
      sheetLabel,
      sharedStrings,
      styles,
      outputPath,
      fallbackIndex: index
    });
    totalCharacters += stats.totalCharacters;
    rowCount += stats.rowCount;
    cellCount += stats.cellCount;
    formulaCount += stats.formulaCount;
    hyperlinkCount += stats.hyperlinkCount;
    dateCellCount += stats.dateCellCount;
    mergedCellCount += stats.mergedCellCount;
    commentCount += stats.commentCount;
    headerRows += stats.headerRows;
  }
  return {
    totalCharacters,
    sharedStringCount: sharedStrings.length,
    dateStyleCount: styles.dateStyleCount,
    dateCellCount,
    mergedCellCount,
    commentCount,
    definedNameCount: definedNames.length,
    namedRangeCount: definedNames.filter((definedName) => definedName.builtinType === "named-range").length,
    printAreaCount: definedNames.filter((definedName) => definedName.builtinType === "print-area").length,
    sheetCount: sheetFiles.length,
    workbookSheetCount: workbookSheets.length,
    sheetRefCount: sheetRecords.length,
    hiddenSheetCount: sheetRecords.filter((record) => record.sheet?.state && record.sheet.state !== "visible").length,
    rowCount,
    cellCount,
    formulaCount,
    hyperlinkCount,
    headerRows,
    parserTrace: [
      {
        stage: "table.workbook.sheets",
        status: workbookSheets.length ? "completed" : "empty",
        sheets: workbookSheets.length,
        sheetRefs: sheetRecords.length,
        hiddenSheets: sheetRecords.filter((record) => record.sheet?.state && record.sheet.state !== "visible").length
      },
      {
        stage: "table.workbook.defined-names",
        status: definedNames.length ? "completed" : "empty",
        definedNames: definedNames.length,
        namedRanges: definedNames.filter((definedName) => definedName.builtinType === "named-range").length,
        printAreas: definedNames.filter((definedName) => definedName.builtinType === "print-area").length
      },
      {
        stage: "table.sheet.headers",
        status: headerRows ? "completed" : "empty",
        headerRows
      },
      {
        stage: "table.sheet.cells",
        status: cellCount ? "completed" : "empty",
        cells: cellCount,
        rows: rowCount,
        sharedStrings: sharedStrings.length
      },
      {
        stage: "table.sheet.date-styles",
        status: dateCellCount ? "completed" : styles.dateStyleCount ? "empty" : "not_applicable",
        dateStyles: styles.dateStyleCount,
        dateCells: dateCellCount
      },
      {
        stage: "table.sheet.merged-cells",
        status: mergedCellCount ? "completed" : "empty",
        mergedCells: mergedCellCount
      },
      {
        stage: "table.sheet.comments",
        status: commentCount ? "completed" : "empty",
        comments: commentCount
      },
      {
        stage: "table.sheet.formulas",
        status: formulaCount ? "completed" : "empty",
        formulas: formulaCount
      },
      {
        stage: "table.sheet.hyperlinks",
        status: hyperlinkCount ? "completed" : "empty",
        hyperlinks: hyperlinkCount
      }
    ]
  };
}

function structuredZipXmlFiles(route = null, rootDir = "") {
  if (route?.id === "word") {
    return collectFiles(rootDir, (name) => (
      /^word\/(document|header\d*|footer\d*|comments|footnotes|endnotes)\.xml$/.test(name) ||
      /^word\/_rels\/(document|header\d*|footer\d*)\.xml\.rels$/.test(name) ||
      /^word\/charts\/chart\d+\.xml$/.test(name)
    ), 240);
  }
  if (route?.id === "presentation") {
    return [
      ...collectFiles(rootDir, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/slide(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/slide(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/slide(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/slide(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/slideLayout(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/slideLayout(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^ppt\/slideLayouts\/_rels\/slideLayout\d+\.xml\.rels$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/slideLayout(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/slideLayout(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/slideMaster(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/slideMaster(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^ppt\/charts\/chart\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/chart(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/chart(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/notesSlide(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/notesSlide(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => name === "ppt/commentAuthors.xml", 1),
      ...collectFiles(rootDir, (name) => /^ppt\/comments\/comment\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/comment(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/comment(\d+)/)?.[1] || 0))
    ];
  }
  if (route?.id === "visio") {
    return [
      ...collectFiles(rootDir, (name) => name === "visio/document.xml", 1),
      ...collectFiles(rootDir, (name) => /^visio\/pages\/page\d+\.xml$/.test(name), 1000)
        .sort((left, right) => visioPartNumber(left.relativePath, /page(\d+)/) - visioPartNumber(right.relativePath, /page(\d+)/)),
      ...collectFiles(rootDir, (name) => /^visio\/pages\/_rels\/page\d+\.xml\.rels$/.test(name), 1000)
        .sort((left, right) => visioPartNumber(left.relativePath, /page(\d+)/) - visioPartNumber(right.relativePath, /page(\d+)/)),
      ...collectFiles(rootDir, (name) => /^visio\/masters\/master\d+\.xml$/.test(name), 1000)
        .sort((left, right) => visioPartNumber(left.relativePath, /master(\d+)/) - visioPartNumber(right.relativePath, /master(\d+)/)),
      ...collectFiles(rootDir, (name) => /^visio\/masters\/_rels\/master\d+\.xml\.rels$/.test(name), 1000)
        .sort((left, right) => visioPartNumber(left.relativePath, /master(\d+)/) - visioPartNumber(right.relativePath, /master(\d+)/))
    ];
  }
  if (route?.id === "spreadsheet") {
    return [
      ...collectFiles(rootDir, (name) => name === "xl/sharedStrings.xml", 1),
      ...collectFiles(rootDir, (name) => name === "xl/styles.xml", 1),
      ...collectFiles(rootDir, (name) => name === "xl/workbook.xml", 1),
      ...collectFiles(rootDir, (name) => name === "xl/_rels/workbook.xml.rels", 1),
      ...collectFiles(rootDir, (name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/sheet(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/sheet(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/sheet(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/sheet(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/drawing(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/drawing(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/drawing(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/drawing(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^xl\/charts\/chart\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/chart(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/chart(\d+)/)?.[1] || 0)),
      ...collectFiles(rootDir, (name) => /^xl\/comments\d+\.xml$/.test(name), 1000)
        .sort((left, right) => Number(left.relativePath.match(/comments(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/comments(\d+)/)?.[1] || 0))
    ];
  }
  if (route?.id === "open-document") {
    return collectFiles(rootDir, (name) => /^(content|styles|meta)\.xml$/.test(name), 20);
  }
  if (route?.id === "ebook") {
    return collectFiles(rootDir, (name) => (
      /\.(xhtml|html|htm|xml)$/i.test(name) &&
      !/(^|\/)(container|package|toc|nav)\.(xml|xhtml|html)$/i.test(name)
    ), 1000).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }
  return [];
}

function structuredZipStage(route = null) {
  if (route?.id === "word") return "office.word.structured";
  if (route?.id === "presentation") return "office.presentation.slides";
  if (route?.id === "visio") return "office.visio.pages";
  if (route?.id === "spreadsheet") return "table.sheet.structured";
  if (route?.id === "open-document") return "open-document.structured";
  if (route?.id === "ebook") return "ebook.epub";
  return "structured-zip.text";
}

function structuredZipEntryFiles(route = null, rootDir = "") {
  return route?.id === "spreadsheet"
    ? [
        ...collectFiles(rootDir, (name) => name === "xl/sharedStrings.xml", 1),
        ...collectFiles(rootDir, (name) => name === "xl/styles.xml", 1),
        ...collectFiles(rootDir, (name) => name === "xl/workbook.xml", 1),
        ...collectFiles(rootDir, (name) => name === "xl/_rels/workbook.xml.rels", 1),
        ...collectFiles(rootDir, (name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name), 1000)
          .sort((left, right) => Number(left.relativePath.match(/sheet(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/sheet(\d+)/)?.[1] || 0)),
        ...collectFiles(rootDir, (name) => /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name), 1000)
          .sort((left, right) => Number(left.relativePath.match(/sheet(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/sheet(\d+)/)?.[1] || 0)),
        ...collectFiles(rootDir, (name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name), 1000)
          .sort((left, right) => Number(left.relativePath.match(/drawing(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/drawing(\d+)/)?.[1] || 0)),
        ...collectFiles(rootDir, (name) => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(name), 1000)
          .sort((left, right) => Number(left.relativePath.match(/drawing(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/drawing(\d+)/)?.[1] || 0)),
        ...collectFiles(rootDir, (name) => /^xl\/charts\/chart\d+\.xml$/.test(name), 1000)
          .sort((left, right) => Number(left.relativePath.match(/chart(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/chart(\d+)/)?.[1] || 0)),
        ...collectFiles(rootDir, (name) => /^xl\/comments\d+\.xml$/.test(name), 1000)
          .sort((left, right) => Number(left.relativePath.match(/comments(\d+)/)?.[1] || 0) - Number(right.relativePath.match(/comments(\d+)/)?.[1] || 0))
      ]
    : structuredZipXmlFiles(route, rootDir);
}

function structuredZipDirectoryEntryPlan(route = null, rootDir = "") {
  const files = structuredZipEntryFiles(route, rootDir);
  let selectedBytes = 0;
  let loadedBytes = 0;
  let skippedLargeFileCount = 0;
  const entries = files.map((file) => {
    const stat = fsSync.statSync(file.absolutePath);
    selectedBytes += stat.size;
    if (stat.size > STRUCTURED_ZIP_ENTRY_MAX_BYTES) {
      skippedLargeFileCount += 1;
      return {
        name: file.relativePath,
        data: Buffer.alloc(0),
        filePath: file.absolutePath,
        uncompressedSize: stat.size,
        warning: "structured-entry-too-large"
      };
    }
    const data = fsSync.readFileSync(file.absolutePath);
    loadedBytes += data.length;
    return {
      name: file.relativePath,
      data,
      filePath: file.absolutePath,
      uncompressedSize: stat.size,
      warning: ""
    };
  });
  return {
    strategy: "structured-zip-entry-bounded-or-streaming.v1",
    routeId: route?.id || "",
    maxEntryBytes: STRUCTURED_ZIP_ENTRY_MAX_BYTES,
    selectedFileCount: files.length,
    loadedFileCount: entries.filter((entry) => !entry.warning).length,
    skippedLargeFileCount,
    selectedBytes,
    loadedBytes,
    entries
  };
}

function structuredZipEntryPlanTrace(plan = {}) {
  return {
    stage: "structured-zip.structural-entry-plan",
    status: plan.selectedFileCount ? "completed" : "empty",
    strategy: plan.strategy || "structured-zip-entry-bounded-or-streaming.v1",
    routeId: plan.routeId || "",
    selectedFiles: Number(plan.selectedFileCount || 0),
    loadedFiles: Number(plan.loadedFileCount || 0),
    skippedLargeFiles: Number(plan.skippedLargeFileCount || 0),
    selectedBytes: Number(plan.selectedBytes || 0),
    loadedBytes: Number(plan.loadedBytes || 0),
    maxEntryBytes: Number(plan.maxEntryBytes || STRUCTURED_ZIP_ENTRY_MAX_BYTES)
  };
}

function structuredZipDirectoryEntries(route = null, rootDir = "") {
  return structuredZipDirectoryEntryPlan(route, rootDir).entries.map((entry) => ({
    name: entry.name,
    data: entry.data,
    warning: entry.warning || ""
  }));
}

function structuredZipTextPrefix(route = null, index = 0, file = {}) {
  if (route?.id === "presentation") {
    return `Slide ${index + 1} (${file.relativePath})`;
  }
  if (route?.id === "visio") {
    return `Visio page ${index + 1} (${file.relativePath})`;
  }
  if (route?.id === "ebook") {
    return `Chapter ${index + 1} (${file.relativePath})`;
  }
  return file.relativePath;
}

function appendStructuredZipFilesAsText({ route = null, rootDir = "", outputPath = "" } = {}) {
  const files = structuredZipXmlFiles(route, rootDir);
  let totalCharacters = 0;
  for (const [index, file] of files.entries()) {
    const heading = `${structuredZipTextPrefix(route, index, file)}:\n`;
    fsSync.appendFileSync(outputPath, heading, "utf8");
    const extractedCharacters = appendMarkupFileAsText(file.absolutePath, outputPath);
    if (!extractedCharacters) {
      continue;
    }
    fsSync.appendFileSync(outputPath, "\n", "utf8");
    totalCharacters += heading.length + extractedCharacters + 1;
  }
  return {
    fileCount: files.length,
    totalCharacters
  };
}

function parseStructuredZipDirectory(route = null, rootDir = "") {
  const entries = structuredZipDirectoryEntries(route, rootDir);
  if (!entries.length) {
    return { text: "", elements: [], format: "", fileCount: 0, parserTrace: [] };
  }
  if (route?.id === "word") {
    const parsed = parseDocx(entries);
    return {
      ...parsed,
      fileCount: entries.length,
      parserTrace: [
        {
          stage: "office.word.structured",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          paragraphs: parsed.paragraphCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          contentControls: parsed.contentControlCount,
          bookmarks: parsed.bookmarkCount,
          headerParts: parsed.headerPartCount,
          footerParts: parsed.footerPartCount,
          headerFooters: parsed.headerFooterElementCount,
          headers: parsed.headerElementCount,
          footers: parsed.footerElementCount,
          annotations: parsed.annotationCount,
          comments: parsed.commentCount,
          footnotes: parsed.footnoteCount,
          endnotes: parsed.endnoteCount,
          revisions: parsed.revisionCount,
          insertedRevisions: parsed.insertionRevisionCount,
          deletedRevisions: parsed.deletionRevisionCount,
          links: parsed.hyperlinkCount,
          images: parsed.imageCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          headings: parsed.headingCount,
          listItems: parsed.listItemCount,
          styles: parsed.styleRefCount,
          numberingRefs: parsed.numberingRefCount
        },
        {
          stage: "office.word.styles",
          status: parsed.styleRefCount ? "completed" : "empty",
          styles: parsed.styleRefCount,
          headings: parsed.headingCount,
          listItems: parsed.listItemCount
        },
        {
          stage: "office.word.numbering",
          status: parsed.numberingRefCount ? "completed" : "empty",
          numberingRefs: parsed.numberingRefCount,
          listItems: parsed.listItemCount
        },
        {
          stage: "office.word.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount
        },
        {
          stage: "office.word.headers-footers",
          status: parsed.headerFooterElementCount ? "completed" : "empty",
          headerParts: parsed.headerPartCount,
          footerParts: parsed.footerPartCount,
          headerFooters: parsed.headerFooterElementCount,
          headers: parsed.headerElementCount,
          footers: parsed.footerElementCount
        },
        {
          stage: "office.word.content-controls",
          status: parsed.contentControlCount ? "completed" : "empty",
          contentControls: parsed.contentControlCount
        },
        {
          stage: "office.word.bookmarks",
          status: parsed.bookmarkCount ? "completed" : "empty",
          bookmarks: parsed.bookmarkCount
        },
        {
          stage: "office.word.annotations",
          status: parsed.annotationCount ? "completed" : "empty",
          annotations: parsed.annotationCount,
          comments: parsed.commentCount,
          footnotes: parsed.footnoteCount,
          endnotes: parsed.endnoteCount
        },
        {
          stage: "office.word.revisions",
          status: parsed.revisionCount ? "completed" : "empty",
          revisions: parsed.revisionCount,
          inserted: parsed.insertionRevisionCount,
          deleted: parsed.deletionRevisionCount
        },
        {
          stage: "office.word.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          links: parsed.hyperlinkCount
        },
        {
          stage: "office.word.images",
          status: parsed.imageCount ? "completed" : "empty",
          images: parsed.imageCount
        },
        {
          stage: "office.word.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        }
      ]
    };
  }
  if (route?.id === "presentation") {
    const parsed = parsePptx(entries);
    return {
      ...parsed,
      fileCount: entries.length,
      parserTrace: [
        {
          stage: "office.presentation.slides",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          slides: parsed.slideCount,
          shapes: parsed.shapeCount,
          placeholders: parsed.placeholderCount,
          shapeMetadata: parsed.shapeMetadataCount,
          geometries: parsed.geometryCount,
          shapeGeometries: parsed.shapeGeometryCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          tableGeometries: parsed.tableGeometryCount,
          speakerNotes: parsed.speakerNoteCount,
          comments: parsed.commentCount,
          commentParts: parsed.commentPartCount,
          commentAuthors: parsed.commentAuthorCount,
          slideLayouts: parsed.slideLayoutPartCount,
          slideMasters: parsed.slideMasterPartCount,
          layoutRefs: parsed.slideLayoutRefCount,
          masterRefs: parsed.slideMasterRefCount,
          hyperlinks: parsed.hyperlinkCount,
          images: parsed.imageCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          chartGeometries: parsed.chartGeometryCount,
          layoutStrategy: parsed.shapeGeometryCount ? "presentationml-shape-geometry.v1" : "",
          headings: parsed.headingCount,
          paragraphs: parsed.paragraphCount
        },
        {
          stage: "office.presentation.layouts",
          status: parsed.slideLayoutRefCount || parsed.slideMasterRefCount ? "completed" : "empty",
          slideLayouts: parsed.slideLayoutPartCount,
          slideMasters: parsed.slideMasterPartCount,
          layoutRefs: parsed.slideLayoutRefCount,
          masterRefs: parsed.slideMasterRefCount
        },
        {
          stage: "office.presentation.placeholders",
          status: parsed.placeholderCount ? "completed" : "empty",
          placeholders: parsed.placeholderCount,
          shapeMetadata: parsed.shapeMetadataCount
        },
        {
          stage: "office.presentation.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount,
          geometries: parsed.tableGeometryCount,
          layoutStrategy: parsed.tableGeometryCount ? "presentationml-table-geometry.v1" : ""
        },
        {
          stage: "office.presentation.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          links: parsed.hyperlinkCount
        },
        {
          stage: "office.presentation.images",
          status: parsed.imageCount ? "completed" : "empty",
          images: parsed.imageCount,
          geometries: parsed.imageGeometryCount
        },
        {
          stage: "office.presentation.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          geometries: parsed.chartGeometryCount
        },
        {
          stage: "office.presentation.speaker-notes",
          status: parsed.speakerNoteCount ? "completed" : "empty",
          notes: parsed.speakerNoteCount
        },
        {
          stage: "office.presentation.comments",
          status: parsed.commentCount ? "completed" : "empty",
          comments: parsed.commentCount,
          commentParts: parsed.commentPartCount,
          authors: parsed.commentAuthorCount
        }
      ]
    };
  }
  if (route?.id === "visio") {
    const parsed = parseVisio(entries);
    return {
      ...parsed,
      fileCount: entries.length,
      parserTrace: [
        {
          stage: "office.visio.pages",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          pages: parsed.pageCount,
          shapes: parsed.shapeCount,
          textShapes: parsed.textShapeCount,
          connectors: parsed.connectorCount,
          geometries: parsed.geometryCount
        },
        {
          stage: "office.visio.shapes",
          status: parsed.shapeCount ? "completed" : "empty",
          shapes: parsed.shapeCount,
          textShapes: parsed.textShapeCount,
          geometries: parsed.geometryCount
        },
        {
          stage: "office.visio.connectors",
          status: parsed.connectorCount ? "completed" : "empty",
          connectors: parsed.connectorCount
        }
      ]
    };
  }
  if (route?.id === "spreadsheet") {
    const parsed = parseXlsxDetailed(entries);
    return {
      ...parsed,
      fileCount: entries.length,
      parserTrace: [
        {
          stage: "table.sheet.structured",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          sheets: parsed.sheetCount,
          workbookSheets: parsed.workbookSheetCount,
          sheetRefs: parsed.sheetRefCount,
          hiddenSheets: parsed.hiddenSheetCount,
          definedNames: parsed.definedNameCount,
          namedRanges: parsed.namedRangeCount,
          printAreas: parsed.printAreaCount,
          rows: parsed.rowCount,
          cells: parsed.cellCount,
          dateStyles: parsed.dateStyleCount,
          dateCells: parsed.dateCellCount,
          mergedCells: parsed.mergedCellCount,
          comments: parsed.commentCount,
          formulas: parsed.formulaCount,
          hyperlinks: parsed.hyperlinkCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        },
        {
          stage: "table.workbook.sheets",
          status: parsed.workbookSheetCount ? "completed" : "empty",
          sheets: parsed.workbookSheetCount,
          sheetRefs: parsed.sheetRefCount,
          hiddenSheets: parsed.hiddenSheetCount
        },
        {
          stage: "table.workbook.defined-names",
          status: parsed.definedNameCount ? "completed" : "empty",
          definedNames: parsed.definedNameCount,
          namedRanges: parsed.namedRangeCount,
          printAreas: parsed.printAreaCount
        },
        {
          stage: "table.sheet.headers",
          status: parsed.headerRows ? "completed" : "empty",
          headerRows: parsed.headerRows
        },
        {
          stage: "table.sheet.cells",
          status: parsed.cellCount ? "completed" : "empty",
          cells: parsed.cellCount,
          rows: parsed.rowCount,
          sharedStrings: parsed.sharedStringCount
        },
        {
          stage: "table.sheet.date-styles",
          status: parsed.dateCellCount ? "completed" : parsed.dateStyleCount ? "empty" : "not_applicable",
          dateStyles: parsed.dateStyleCount,
          dateCells: parsed.dateCellCount
        },
        {
          stage: "table.sheet.merged-cells",
          status: parsed.mergedCellCount ? "completed" : "empty",
          mergedCells: parsed.mergedCellCount
        },
        {
          stage: "table.sheet.comments",
          status: parsed.commentCount ? "completed" : "empty",
          comments: parsed.commentCount
        },
        {
          stage: "table.sheet.formulas",
          status: parsed.formulaCount ? "completed" : "empty",
          formulas: parsed.formulaCount
        },
        {
          stage: "table.sheet.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          hyperlinks: parsed.hyperlinkCount
        },
        {
          stage: "table.sheet.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        }
      ]
    };
  }
  if (route?.id === "open-document") {
    const parsed = parseOpenDocument(entries);
    return {
      ...parsed,
      fileCount: entries.length,
      parserTrace: [
        {
          stage: "open-document.structured",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          headings: parsed.headingCount,
          paragraphs: parsed.paragraphCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          links: parsed.linkCount
        },
        {
          stage: "open-document.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount
        },
        {
          stage: "open-document.hyperlinks",
          status: parsed.linkCount ? "completed" : "empty",
          links: parsed.linkCount
        }
      ]
    };
  }
  if (route?.id === "ebook") {
    const parsed = parseEpub(entries);
    return {
      ...parsed,
      fileCount: entries.length,
      parserTrace: [{
        stage: "ebook.epub",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        elements: parsed.elements.length,
        chapters: parsed.chapterCount,
        headings: parsed.headingCount,
        paragraphs: parsed.paragraphCount
      }]
    };
  }
  return { text: "", elements: [], format: "", fileCount: entries.length, parserTrace: [] };
}

function parseArchiveManifest(entries = []) {
  return entries
    .slice(0, 1000)
    .map((entry) => `${entry.name} (${entry.uncompressedSize || entry.data.length || 0} bytes${entry.warning ? `; ${entry.warning}` : ""})`)
    .join("\n");
}

function decodePdfLiteral(value = "") {
  const text = String(value || "");
  const inner = text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text;
  let output = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = inner[index + 1] || "";
    if (!next) {
      continue;
    }
    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (/[0-7]/.test(next)) {
      const octal = inner.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] || "";
      output += String.fromCharCode(parseInt(octal, 8));
      index += octal.length;
      continue;
    } else {
      output += next;
    }
    index += 1;
  }
  return output;
}

function decodePdfHex(value = "") {
  const hex = String(value || "").replace(/[^0-9a-f]/gi, "");
  if (!hex) {
    return "";
  }
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  return Buffer.from(padded, "hex").toString("utf8").replace(/\u0000/g, "");
}

function pdfNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundLayoutNumber(value = 0) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function pdfTextWidth(text = "", fontSize = 12) {
  return roundLayoutNumber(Math.max(1, String(text || "").length) * Math.max(1, Number(fontSize) || 12) * 0.52);
}

function pdfTextTokenValue(token = null) {
  if (!token) {
    return "";
  }
  if (token.type === "string" || token.type === "hex") {
    return token.value;
  }
  if (token.type === "array") {
    return token.items.map(pdfTextTokenValue).join("");
  }
  return "";
}

function decodePdfStringTokenValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("(")) {
    return decodePdfLiteral(raw);
  }
  if (/^<[0-9a-fA-F\s]+>$/.test(raw)) {
    return decodePdfHex(raw.slice(1, -1));
  }
  return raw;
}

function parsePdfRect(value = "") {
  const numbers = String(value || "")
    .trim()
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  if (numbers.length < 4) {
    return null;
  }
  const [x1, y1, x2, y2] = numbers;
  return {
    x: roundLayoutNumber(Math.min(x1, x2)),
    y: roundLayoutNumber(Math.min(y1, y2)),
    width: roundLayoutNumber(Math.abs(x2 - x1)),
    height: roundLayoutNumber(Math.abs(y2 - y1))
  };
}

function pdfIndirectObjectBodies(latin = "") {
  const objectBodies = new Map();
  for (const match of String(latin || "").matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g)) {
    objectBodies.set(match[1], match[2] || "");
  }
  return objectBodies;
}

function pdfFirstObjectRef(value = "") {
  return String(value || "").match(/(\d+)\s+\d+\s+R/)?.[1] || "";
}

function pdfPageNumberByObject(objectBodies = new Map()) {
  const pageByObject = new Map();
  let page = 0;
  for (const [objectNumber, body] of objectBodies.entries()) {
    if (!/\/Type\s*\/Page(?!s)\b/.test(body)) {
      continue;
    }
    page += 1;
    pageByObject.set(objectNumber, page);
  }
  return pageByObject;
}

function extractPdfUriLinks(latin = "", objectBodies = pdfIndirectObjectBodies(latin), pageByObject = pdfPageNumberByObject(objectBodies)) {
  const pageByAnnotationObject = new Map();
  for (const [pageObjectNumber, body] of objectBodies.entries()) {
    if (!/\/Type\s*\/Page(?!s)\b/.test(body)) {
      continue;
    }
    const page = pageByObject.get(pageObjectNumber) || 1;
    const annots = body.match(/\/Annots\s*\[([\s\S]*?)\]/)?.[1] || "";
    for (const ref of annots.matchAll(/(\d+)\s+\d+\s+R/g)) {
      pageByAnnotationObject.set(ref[1], page);
    }
  }

  const links = [];
  const seen = new Set();
  for (const [objectNumber, body] of objectBodies.entries()) {
    if (!/\/Subtype\s*\/Link\b/.test(body) || !/\/S\s*\/URI\b/.test(body)) {
      continue;
    }
    const uriToken = body.match(/\/URI\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)/)?.[1] || "";
    const href = decodePdfStringTokenValue(uriToken);
    if (!href) {
      continue;
    }
    const rect = parsePdfRect(body.match(/\/Rect\s*\[([^\]]+)\]/)?.[1] || "");
    const label = decodePdfStringTokenValue(body.match(/\/Contents\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)/)?.[1] || "") || href;
    const pageNumber = pageByAnnotationObject.get(objectNumber) || 1;
    const key = `${pageNumber}:${href}:${JSON.stringify(rect || {})}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push({
      href,
      text: label,
      page: pageNumber,
      objectNumber,
      bbox: rect
    });
  }
  return links;
}

function pdfPageByAnnotationObject(objectBodies = new Map(), pageByObject = pdfPageNumberByObject(objectBodies)) {
  const pageByAnnotationObject = new Map();
  for (const [pageObjectNumber, body] of objectBodies.entries()) {
    if (!/\/Type\s*\/Page(?!s)\b/.test(body)) {
      continue;
    }
    const page = pageByObject.get(pageObjectNumber) || 1;
    const annots = body.match(/\/Annots\s*\[([\s\S]*?)\]/)?.[1] || "";
    for (const ref of annots.matchAll(/(\d+)\s+\d+\s+R/g)) {
      pageByAnnotationObject.set(ref[1], page);
    }
  }
  return pageByAnnotationObject;
}

function decodePdfName(value = "") {
  return String(value || "")
    .replace(/^\//, "")
    .replace(/#([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function pdfScalarToken(body = "", key = "") {
  const pattern = new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9a-fA-F\\s]+>|/[A-Za-z0-9_.#-]+)`);
  return String(body || "").match(pattern)?.[1] || "";
}

function pdfScalarValue(body = "", key = "") {
  const token = pdfScalarToken(body, key);
  if (!token) {
    return "";
  }
  return token.startsWith("/") ? decodePdfName(token) : decodePdfStringTokenValue(token);
}

function pdfFormFieldTypeLabel(fieldType = "") {
  const normalized = String(fieldType || "").replace(/^\//, "");
  if (normalized === "Tx") return "text";
  if (normalized === "Btn") return "button";
  if (normalized === "Ch") return "choice";
  if (normalized === "Sig") return "signature";
  return normalized || "unknown";
}

function pdfObjectRefs(value = "") {
  return Array.from(String(value || "").matchAll(/(\d+)\s+\d+\s+R/g)).map((match) => match[1]);
}

function pdfFormFieldFromObject({
  objectNumber = "",
  body = "",
  inherited = {},
  pageByAnnotationObject = new Map(),
  pageByObject = new Map()
} = {}) {
  const rawFieldType = pdfScalarValue(body, "FT") || inherited.rawFieldType || "";
  const fieldName = pdfScalarValue(body, "T") || inherited.name || "";
  const alternateName = pdfScalarValue(body, "TU") || inherited.alternateName || "";
  const value = pdfScalarValue(body, "V") || pdfScalarValue(body, "DV") || pdfScalarValue(body, "AS") || inherited.value || "";
  const pageObject = pdfFirstObjectRef(String(body || "").match(/\/P\s+(\d+\s+\d+\s+R)/)?.[1] || "");
  const page = pageByAnnotationObject.get(objectNumber) || (pageObject ? pageByObject.get(pageObject) : 0) || inherited.page || 1;
  const rect = parsePdfRect(String(body || "").match(/\/Rect\s*\[([^\]]+)\]/)?.[1] || "");
  if (!rawFieldType && !/\/Subtype\s*\/Widget\b/.test(body)) {
    return null;
  }
  const name = fieldName || alternateName || `field-${objectNumber || "unknown"}`;
  const fieldType = pdfFormFieldTypeLabel(rawFieldType);
  return {
    objectNumber,
    name,
    alternateName,
    fieldType,
    rawFieldType,
    value,
    page,
    bbox: rect,
    required: Boolean(Number(String(body || "").match(/\/Ff\s+(\d+)/)?.[1] || 0) & 2),
    readOnly: Boolean(Number(String(body || "").match(/\/Ff\s+(\d+)/)?.[1] || 0) & 1),
    text: compactMarkupText(`${name}${value ? `: ${value}` : ""}${alternateName && alternateName !== name ? ` (${alternateName})` : ""}`, 800)
  };
}

function extractPdfFormFields(latin = "", objectBodies = pdfIndirectObjectBodies(latin), pageByObject = pdfPageNumberByObject(objectBodies)) {
  const pageByAnnotationObject = pdfPageByAnnotationObject(objectBodies, pageByObject);
  const fields = [];
  const seen = new Set();
  const pushField = (field = null) => {
    if (!field?.text) {
      return;
    }
    const key = `${field.objectNumber}:${field.name}:${field.value}:${field.page}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    fields.push(field);
  };
  for (const [objectNumber, body] of objectBodies.entries()) {
    if (!/\/FT\s*\/|\/Subtype\s*\/Widget\b/.test(body)) {
      continue;
    }
    const inherited = {
      rawFieldType: pdfScalarValue(body, "FT"),
      name: pdfScalarValue(body, "T"),
      alternateName: pdfScalarValue(body, "TU"),
      value: pdfScalarValue(body, "V") || pdfScalarValue(body, "DV") || pdfScalarValue(body, "AS"),
      page: pageByAnnotationObject.get(objectNumber) || 0
    };
    const kids = pdfObjectRefs(String(body || "").match(/\/Kids\s*\[([\s\S]*?)\]/)?.[1] || "");
    if (kids.length) {
      for (const kidObjectNumber of kids) {
        const kidBody = objectBodies.get(kidObjectNumber) || "";
        pushField(pdfFormFieldFromObject({
          objectNumber: kidObjectNumber,
          body: kidBody,
          inherited,
          pageByAnnotationObject,
          pageByObject
        }));
      }
      if (!/\/Rect\s*\[/.test(body)) {
        continue;
      }
    }
    pushField(pdfFormFieldFromObject({
      objectNumber,
      body,
      inherited,
      pageByAnnotationObject,
      pageByObject
    }));
  }
  return fields;
}

function pdfOutlinePage(body = "", pageByObject = new Map()) {
  const destination = String(body || "").match(/\/(?:Dest|D)\s*\[([^\]]+)\]/)?.[1] || "";
  const pageObject = pdfFirstObjectRef(destination);
  if (pageObject && pageByObject.has(pageObject)) {
    return pageByObject.get(pageObject);
  }
  const actionDestination = String(body || "").match(/\/A\s*<<[\s\S]*?\/D\s*\[([^\]]+)\][\s\S]*?>>/)?.[1] || "";
  const actionPageObject = pdfFirstObjectRef(actionDestination);
  if (actionPageObject && pageByObject.has(actionPageObject)) {
    return pageByObject.get(actionPageObject);
  }
  return null;
}

function extractPdfOutlineItems(latin = "", objectBodies = pdfIndirectObjectBodies(latin), pageByObject = pdfPageNumberByObject(objectBodies)) {
  const catalogBody = Array.from(objectBodies.values()).find((body) => /\/Type\s*\/Catalog\b/.test(body)) || "";
  const outlinesObject = pdfFirstObjectRef(catalogBody.match(/\/Outlines\s+(\d+\s+\d+\s+R)/)?.[1] || "");
  const outlineRoot = outlinesObject ? objectBodies.get(outlinesObject) || "" : "";
  const firstOutline = pdfFirstObjectRef(outlineRoot.match(/\/First\s+(\d+\s+\d+\s+R)/)?.[1] || "");
  const items = [];
  const visited = new Set();
  const walk = (objectNumber = "", level = 1) => {
    let current = objectNumber;
    while (current && objectBodies.has(current) && !visited.has(current)) {
      visited.add(current);
      const body = objectBodies.get(current) || "";
      const title = decodePdfStringTokenValue(body.match(/\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)/)?.[1] || "");
      if (title) {
        items.push({
          text: title,
          level: Math.max(1, Number(level || 1)),
          page: pdfOutlinePage(body, pageByObject) || 1,
          objectNumber: current
        });
      }
      const child = pdfFirstObjectRef(body.match(/\/First\s+(\d+\s+\d+\s+R)/)?.[1] || "");
      if (child) {
        walk(child, level + 1);
      }
      current = pdfFirstObjectRef(body.match(/\/Next\s+(\d+\s+\d+\s+R)/)?.[1] || "");
    }
  };
  if (firstOutline) {
    walk(firstOutline, 1);
  }
  if (!items.length) {
    for (const [objectNumber, body] of objectBodies.entries()) {
      if (!/\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)/.test(body) || !/(\/Dest\s*\[|\/A\s*<<[\s\S]*?\/S\s*\/GoTo\b)/.test(body)) {
        continue;
      }
      const title = decodePdfStringTokenValue(body.match(/\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)/)?.[1] || "");
      if (!title) {
        continue;
      }
      items.push({
        text: title,
        level: 1,
        page: pdfOutlinePage(body, pageByObject) || 1,
        objectNumber
      });
    }
  }
  return items;
}

function tokenizePdfTextBlock(block = "") {
  const tokens = [];
  const pattern = /\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>|\[|\]|\/[^\s<>\[\]()]+|-?(?:\d+\.\d+|\d+|\.\d+)|TJ|Tj|Tf|Td|TD|Tm|T\*|'|"|[A-Za-z*]+/g;
  let array = null;
  for (const match of String(block || "").matchAll(pattern)) {
    const raw = match[0];
    let token;
    if (raw === "[") {
      array = [];
      continue;
    }
    if (raw === "]") {
      token = { type: "array", items: array || [] };
      array = null;
    } else if (raw.startsWith("(")) {
      token = { type: "string", value: decodePdfLiteral(raw) };
    } else if (/^<[0-9a-fA-F\s]+>$/.test(raw)) {
      token = { type: "hex", value: decodePdfHex(raw.slice(1, -1)) };
    } else if (/^-?(?:\d+\.\d+|\d+|\.\d+)$/.test(raw)) {
      token = { type: "number", value: pdfNumber(raw) };
    } else {
      token = { type: "operator", value: raw };
    }
    if (array) {
      array.push(token);
    } else {
      tokens.push(token);
    }
  }
  return tokens;
}

function textFromPdfArrayToken(token = null) {
  if (!token || token.type !== "array") {
    return "";
  }
  return token.items
    .filter((item) => item.type === "string" || item.type === "hex")
    .map((item) => item.value)
    .join("");
}

function extractPdfLayoutFromContent(content = "", context = {}) {
  const runs = [];
  const chunks = [];
  const blocks = Array.from(String(content || "").matchAll(/BT([\s\S]*?)ET/g)).map((match) => match[1]);
  let order = Number(context.orderStart || 0);
  for (const block of blocks) {
    const tokens = tokenizePdfTextBlock(block);
    let operands = [];
    let x = 0;
    let y = 0;
    let fontSize = 12;
    const emit = (text = "") => {
      const normalized = String(text || "").replace(/\s+/g, " ").trim();
      if (!normalized) {
        return;
      }
      const bbox = {
        x: roundLayoutNumber(x),
        y: roundLayoutNumber(y),
        width: pdfTextWidth(normalized, fontSize),
        height: roundLayoutNumber(Math.max(1, fontSize))
      };
      order += 1;
      chunks.push(normalized);
      runs.push({
        text: normalized,
        page: Number(context.page || 1),
        streamIndex: Number(context.streamIndex || 0),
        order,
        x: bbox.x,
        y: bbox.y,
        bbox,
        fontSize: roundLayoutNumber(fontSize)
      });
      x += bbox.width;
    };
    for (const token of tokens) {
      if (token.type !== "operator") {
        operands.push(token);
        continue;
      }
      const op = token.value;
      const numbers = operands.filter((item) => item.type === "number").map((item) => item.value);
      if (op === "Tf") {
        fontSize = numbers.at(-1) || fontSize;
      } else if (op === "Td" || op === "TD") {
        x += numbers.at(-2) || 0;
        y += numbers.at(-1) || 0;
      } else if (op === "Tm" && numbers.length >= 6) {
        x = numbers[numbers.length - 2];
        y = numbers[numbers.length - 1];
      } else if (op === "T*") {
        y -= Math.max(1, fontSize) * 1.2;
      } else if (op === "Tj") {
        emit(pdfTextTokenValue(operands.at(-1)));
      } else if (op === "TJ") {
        emit(textFromPdfArrayToken(operands.at(-1)));
      } else if (op === "'") {
        y -= Math.max(1, fontSize) * 1.2;
        emit(pdfTextTokenValue(operands.at(-1)));
      } else if (op === "\"") {
        y -= Math.max(1, fontSize) * 1.2;
        emit(pdfTextTokenValue(operands.at(-1)));
      }
      operands = [];
    }
  }
  return {
    text: chunks.join("\n"),
    runs,
    nextOrder: order
  };
}

function extractPdfTextFromContent(content = "") {
  return extractPdfLayoutFromContent(content).text
    .split("\n")
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function parsePdfBasicText(buffer) {
  const data = Buffer.from(buffer || []);
  const latin = data.toString("latin1");
  const parserTrace = [];
  const warnings = [];
  const textChunks = [];
  const layoutRuns = [];
  const objectBodies = pdfIndirectObjectBodies(latin);
  const pageByObject = pdfPageNumberByObject(objectBodies);
  const uriLinks = extractPdfUriLinks(latin, objectBodies, pageByObject);
  const outlineItems = extractPdfOutlineItems(latin, objectBodies, pageByObject);
  const formFields = extractPdfFormFields(latin, objectBodies, pageByObject);
  let layoutOrder = 0;
  let streamCount = 0;
  let decodedStreamCount = 0;
  for (const match of latin.matchAll(/<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g)) {
    streamCount += 1;
    const dictionary = match[1] || "";
    const rawStream = Buffer.from(match[2] || "", "latin1");
    let decoded = rawStream;
    if (/\/Filter\s*\/FlateDecode/.test(dictionary) || /\/FlateDecode/.test(dictionary)) {
      try {
        decoded = Buffer.from(inflateSync(rawStream));
      } catch (_error) {
        try {
          decoded = Buffer.from(inflateRawSync(rawStream));
        } catch (error) {
          warnings.push(`pdf-flate-decode-failed:${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
    }
    decodedStreamCount += 1;
    const content = decoded.toString("latin1");
    const layout = extractPdfLayoutFromContent(content, {
      page: streamCount,
      streamIndex: streamCount,
      orderStart: layoutOrder
    });
    layoutOrder = layout.nextOrder;
    if (layout.text) {
      textChunks.push(layout.text);
      layoutRuns.push(...layout.runs);
    }
  }
  const title = latin.match(/\/Title\s*(\((?:\\.|[^\\)])*\))/)?.[1];
  if (title) {
    textChunks.unshift(`Title: ${decodePdfLiteral(title)}`);
  }
  const formTextChunks = formFields.map((field) => `PDF form field ${field.fieldType}: ${field.text}`);
  const text = [...textChunks, ...formTextChunks].join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  const elements = [];
  textChunks.forEach((chunk, index) => {
    if (chunk && index === 0 && /^Title:\s*/i.test(chunk)) {
      pushStructureElement(elements, "title", chunk.replace(/^Title:\s*/i, ""), { level: 1, line: index + 1, name: "pdf-info" });
    }
  });
  outlineItems.forEach((item, index) => {
    pushStructureElement(elements, "pdf-outline", item.text, {
      level: item.level,
      line: index + 1,
      name: `pdf-outline-${item.objectNumber || index + 1}`,
      page: item.page,
      layout: {
        strategy: "pdf-outline-destination.v1",
        page: item.page,
        outlineObject: item.objectNumber,
        order: index + 1
      },
      limit: 800
    });
  });
  for (const run of layoutRuns
    .slice()
    .sort((left, right) => left.page - right.page || right.y - left.y || left.x - right.x || left.order - right.order)) {
    pushStructureElement(elements, "pdf-text-block", run.text, {
      line: run.order,
      name: `page-${run.page}`,
      page: run.page,
      bbox: run.bbox,
      layout: {
        strategy: "pdf-text-operator-geometry.v1",
        page: run.page,
        streamIndex: run.streamIndex,
        order: run.order,
        x: run.x,
        y: run.y,
        fontSize: run.fontSize
      }
    });
  }
  uriLinks.forEach((link, index) => {
    pushStructureElement(elements, "link", link.text || link.href, {
      line: layoutOrder + index + 1,
      name: "pdf-uri-annotation",
      page: link.page,
      href: link.href,
      bbox: link.bbox,
      layout: {
        strategy: "pdf-uri-annotation.v1",
        page: link.page,
        annotationObject: link.objectNumber,
        order: layoutOrder + index + 1
      },
      limit: 800
    });
  });
  formFields.forEach((field, index) => {
    pushStructureElement(elements, "pdf-form-field", field.text, {
      line: layoutOrder + uriLinks.length + index + 1,
      name: `pdf-form-field-${field.objectNumber || index + 1}`,
      page: field.page,
      bbox: field.bbox,
      layout: {
        strategy: "pdf-form-field.v1",
        page: field.page,
        fieldObject: field.objectNumber,
        order: layoutOrder + uriLinks.length + index + 1
      },
      form: {
        strategy: "pdf-form-field.v1",
        objectNumber: field.objectNumber,
        name: field.name,
        alternateName: field.alternateName,
        fieldType: field.fieldType,
        rawFieldType: field.rawFieldType,
        value: field.value,
        required: field.required,
        readOnly: field.readOnly
      },
      limit: 1000
    });
  });
  parserTrace.push({
    stage: "pdf.text.basic",
    status: text ? "completed" : "empty",
    streamCount,
    decodedStreamCount,
    characters: text.length,
    elements: elements.length,
    layoutBlocks: layoutRuns.length,
    layoutStrategy: "pdf-text-operator-geometry.v1"
  });
  parserTrace.push({
    stage: "pdf.hyperlinks",
    status: uriLinks.length ? "completed" : "empty",
    links: uriLinks.length,
    strategy: "pdf-uri-annotation.v1"
  });
  parserTrace.push({
    stage: "pdf.outlines",
    status: outlineItems.length ? "completed" : "empty",
    outlines: outlineItems.length,
    strategy: "pdf-outline-destination.v1"
  });
  parserTrace.push({
    stage: "pdf.form-fields",
    status: formFields.length ? "completed" : "empty",
    fields: formFields.length,
    widgets: formFields.filter((field) => field.bbox).length,
    strategy: "pdf-form-field.v1"
  });
  if (!text) {
    warnings.push("pdf-basic-text-empty");
  }
  return { text, parserTrace, warnings, elements, format: "pdf" };
}

function countPdfMatches(latin = "", pattern) {
  return (String(latin || "").match(pattern) || []).length;
}

function buildPdfSubtypeProfile({
  source = "payload",
  buffer = null,
  byteSize = 0,
  textCharacters = 0,
  layoutBlocks = 0,
  ocrCharacters = 0,
  tikaCharacters = 0,
  parserWarnings = []
} = {}) {
  const latin = buffer?.length ? Buffer.from(buffer).toString("latin1") : "";
  const effectiveByteSize = Number(byteSize || buffer?.length || 0);
  const extractedTextCharacters = Number(textCharacters || 0);
  const effectiveOcrCharacters = Number(ocrCharacters || 0);
  const effectiveTikaCharacters = Number(tikaCharacters || 0);
  const imageObjectCount = latin ? countPdfMatches(latin, /\/Subtype\s*\/Image\b/g) : 0;
  const fontObjectCount = latin ? countPdfMatches(latin, /\/Type\s*\/Font\b|\/Font\s*<</g) : 0;
  const toUnicodeMapCount = latin ? countPdfMatches(latin, /\/ToUnicode\b|beginbfchar|beginbfrange/g) : 0;
  const pageCount = latin ? Math.max(0, countPdfMatches(latin, /\/Type\s*\/Page(?!s)\b/g)) : 0;
  const streamCount = latin ? countPdfMatches(latin, /\bstream\r?\n?/g) : 0;
  const encrypted = latin ? /\/Encrypt\b/.test(latin) : false;
  const outputCharacters = extractedTextCharacters + effectiveOcrCharacters + effectiveTikaCharacters;
  const textDensity = effectiveByteSize > 0 ? Number((outputCharacters / effectiveByteSize).toFixed(6)) : 0;
  let subtype = "pdf-empty-or-unknown";
  if (encrypted) {
    subtype = "pdf-encrypted";
  } else if (extractedTextCharacters > 0) {
    subtype = "pdf-text";
  } else if (effectiveOcrCharacters > 0) {
    subtype = "pdf-scanned";
  } else if (effectiveTikaCharacters > 0) {
    subtype = "pdf-text";
  } else if (imageObjectCount > 0) {
    subtype = "pdf-image-heavy";
  } else if (fontObjectCount > 0 && toUnicodeMapCount === 0) {
    subtype = "pdf-font-broken";
  }
  const riskFlags = [];
  if (subtype === "pdf-scanned" || subtype === "pdf-image-heavy") {
    riskFlags.push("ocr-required");
  }
  if (subtype === "pdf-font-broken") {
    riskFlags.push("font-mapping-risk");
  }
  if (subtype === "pdf-encrypted") {
    riskFlags.push("encrypted-pdf");
  }
  if (subtype === "pdf-empty-or-unknown") {
    riskFlags.push("pdf-empty-or-unknown");
  }
  if (imageObjectCount > 0 && outputCharacters > 0 && subtype !== "pdf-scanned") {
    riskFlags.push("pdf-image-mixed");
  }
  if (outputCharacters > 0 && outputCharacters < 800) {
    riskFlags.push("pdf-low-text-density");
  }
  return {
    strategy: PDF_SUBTYPE_ROUTING_STRATEGY,
    source,
    subtype,
    byteSize: effectiveByteSize,
    textDensity,
    pageCount,
    streamCount,
    imageObjectCount,
    fontObjectCount,
    toUnicodeMapCount,
    encrypted,
    layoutBlocks: Number(layoutBlocks || 0),
    textCharacters: extractedTextCharacters,
    ocrCharacters: effectiveOcrCharacters,
    tikaCharacters: effectiveTikaCharacters,
    outputCharacters,
    riskFlags: uniqueOrdered(riskFlags),
    warnings: uniqueOrdered(parserWarnings).slice(0, 20)
  };
}

function pdfSubtypeTrace(profile = {}) {
  return {
    stage: "pdf.subtype-route",
    status: "completed",
    strategy: profile.strategy || PDF_SUBTYPE_ROUTING_STRATEGY,
    source: profile.source || "",
    subtype: profile.subtype || "pdf-empty-or-unknown",
    byteSize: Number(profile.byteSize || 0),
    textDensity: Number(profile.textDensity || 0),
    pageCount: Number(profile.pageCount || 0),
    imageObjects: Number(profile.imageObjectCount || 0),
    fontObjects: Number(profile.fontObjectCount || 0),
    toUnicodeMaps: Number(profile.toUnicodeMapCount || 0),
    layoutBlocks: Number(profile.layoutBlocks || 0),
    textCharacters: Number(profile.textCharacters || 0),
    ocrCharacters: Number(profile.ocrCharacters || 0),
    tikaCharacters: Number(profile.tikaCharacters || 0),
    riskFlags: profile.riskFlags || []
  };
}

function runtimeStageTrace(stage, runtimeStatus = null, runtimeKey = "") {
  const runtime = runtimeKey ? runtimeStatus?.runtimes?.[runtimeKey] : null;
  if (!runtime) {
    return { stage, status: "requires-external-runtime" };
  }
  return {
    stage,
    status: runtime.available ? "available-not-executed" : "unavailable",
    runtime: runtimeKey,
    command: runtime.command || "",
    error: runtime.available ? "" : runtime.error || "runtime-unavailable"
  };
}

function tempWorkDir(prefix = "external-kd-") {
  const root = path.join(os.tmpdir(), prefix);
  return fsSync.mkdtempSync(root);
}

function safeExtension(extension = "") {
  const normalized = normalizeExtension(extension || ".bin");
  return /^[.][a-z0-9]+$/i.test(normalized) ? normalized : ".bin";
}

function runTesseractOnImageFile(filePath, runtimeStatus, stage = "ocr.image") {
  const runtime = runtimeStatus?.runtimes?.["ocr.tesseract"];
  if (!runtime?.available) {
    return {
      text: "",
      trace: runtimeStageTrace(stage, runtimeStatus, "ocr.tesseract"),
      warning: "missing-runtime:ocr.tesseract"
    };
  }
  try {
    const text = execFileSync(runtime.command || "tesseract", [filePath, "stdout"], {
      encoding: "utf8",
      timeout: OCR_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    }).trim();
    return {
      text,
      trace: {
        stage,
        status: text ? "completed" : "empty",
        runtime: "ocr.tesseract",
        command: runtime.command || "tesseract",
        characters: text.length
      },
      warning: text ? "" : "ocr-empty"
    };
  } catch (error) {
    return {
      text: "",
      trace: {
        stage,
        status: "failed",
        runtime: "ocr.tesseract",
        command: runtime.command || "tesseract",
        error: error instanceof Error ? error.message : String(error)
      },
      warning: "ocr-failed"
    };
  }
}

function runImageOcr(buffer, metadata = {}, runtimeStatus = null) {
  const workDir = tempWorkDir("external-kd-image-");
  try {
    const imagePath = path.join(workDir, `source${safeExtension(metadata.extension || ".png")}`);
    fsSync.writeFileSync(imagePath, Buffer.from(buffer || []));
    const result = runTesseractOnImageFile(imagePath, runtimeStatus, "ocr.image");
    return {
      text: result.text,
      parserTrace: [result.trace],
      warnings: result.warning ? [result.warning] : []
    };
  } finally {
    fsSync.rmSync(workDir, { recursive: true, force: true });
  }
}

function runPdfOcr(buffer, runtimeStatus = null) {
  const poppler = runtimeStatus?.runtimes?.["pdf.poppler"];
  const tesseract = runtimeStatus?.runtimes?.["ocr.tesseract"];
  const parserTrace = [];
  const warnings = [];
  if (!poppler?.available || !tesseract?.available) {
    parserTrace.push(runtimeStageTrace("pdf.page-rasterize", runtimeStatus, "pdf.poppler"));
    parserTrace.push(runtimeStageTrace("ocr.image", runtimeStatus, "ocr.tesseract"));
    warnings.push(requiredRuntimeWarning(runtimeStatus, ["pdf.poppler", "ocr.tesseract"]) || "pdf-ocr-runtime-required");
    return { text: "", parserTrace, warnings };
  }
  const workDir = tempWorkDir("external-kd-pdf-");
  try {
    const pdfPath = path.join(workDir, "source.pdf");
    const outputPrefix = path.join(workDir, "page");
    fsSync.writeFileSync(pdfPath, Buffer.from(buffer || []));
    execFileSync(poppler.command || "pdftoppm", [
      "-png",
      "-r",
      "200",
      "-f",
      "1",
      "-l",
      String(Math.max(1, PDF_OCR_MAX_PAGES)),
      pdfPath,
      outputPrefix
    ], {
      encoding: "utf8",
      timeout: OCR_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    });
    const pageFiles = fsSync.readdirSync(workDir)
      .filter((fileName) => /^page-\d+\.png$/.test(fileName))
      .sort((left, right) => Number(left.match(/page-(\d+)/)?.[1] || 0) - Number(right.match(/page-(\d+)/)?.[1] || 0));
    parserTrace.push({
      stage: "pdf.page-rasterize",
      status: pageFiles.length ? "completed" : "empty",
      runtime: "pdf.poppler",
      command: poppler.command || "pdftoppm",
      pages: pageFiles.length
    });
    const texts = [];
    for (const [index, fileName] of pageFiles.entries()) {
      const result = runTesseractOnImageFile(path.join(workDir, fileName), runtimeStatus, "ocr.page");
      parserTrace.push({ ...result.trace, page: index + 1 });
      if (result.warning) {
        warnings.push(result.warning);
      }
      if (result.text) {
        texts.push(`Page ${index + 1}: ${result.text}`);
      }
    }
    return {
      text: texts.join("\n\n").trim(),
      parserTrace,
      warnings
    };
  } catch (error) {
    parserTrace.push({
      stage: "pdf.page-rasterize",
      status: "failed",
      runtime: "pdf.poppler",
      command: poppler.command || "pdftoppm",
      error: error instanceof Error ? error.message : String(error)
    });
    warnings.push("pdf-ocr-failed");
    return { text: "", parserTrace, warnings };
  } finally {
    fsSync.rmSync(workDir, { recursive: true, force: true });
  }
}

function runTikaText(buffer, metadata = {}, runtimeStatus = null, stage = "tika.text") {
  const runtime = runtimeStatus?.runtimes?.["tika.app"];
  if (!runtime?.available) {
    return {
      text: "",
      parserTrace: [runtimeStageTrace(stage, runtimeStatus, "tika.app")],
      warnings: ["missing-runtime:tika.app"]
    };
  }
  const workDir = tempWorkDir("external-kd-tika-");
  try {
    const inputPath = path.join(workDir, `source${safeExtension(metadata.extension || ".bin")}`);
    fsSync.writeFileSync(inputPath, Buffer.from(buffer || []));
    const text = execFileSync(runtime.command || "java", ["-jar", runtime.jarPath || TIKA_APP_JAR, "-t", inputPath], {
      encoding: "utf8",
      timeout: TIKA_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024
    }).trim();
    return {
      text,
      parserTrace: [{
        stage,
        status: text ? "completed" : "empty",
        runtime: "tika.app",
        command: runtime.command || "java",
        jarPath: runtime.jarPath || TIKA_APP_JAR,
        characters: text.length
      }],
      warnings: text ? [] : ["tika-empty"]
    };
  } catch (error) {
    return {
      text: "",
      parserTrace: [{
        stage,
        status: "failed",
        runtime: "tika.app",
        command: runtime.command || "java",
        jarPath: runtime.jarPath || TIKA_APP_JAR,
        error: error instanceof Error ? error.message : String(error)
      }],
      warnings: ["tika-failed"]
    };
  } finally {
    fsSync.rmSync(workDir, { recursive: true, force: true });
  }
}

function runTikaFileToTextFile(inputPath = "", outputPath = "", metadata = {}, runtimeStatus = null, stage = "tika.text.file-ref") {
  const runtime = runtimeStatus?.runtimes?.["tika.app"];
  if (!runtime?.available) {
    return {
      parserTrace: [runtimeStageTrace(stage, runtimeStatus, "tika.app")],
      warnings: ["missing-runtime:tika.app"]
    };
  }
  let output = null;
  try {
    output = fsSync.openSync(outputPath, "w");
    const result = spawnSync(runtime.command || "java", ["-jar", runtime.jarPath || TIKA_APP_JAR, "-t", inputPath], {
      stdio: ["ignore", output, "pipe"],
      timeout: TIKA_TIMEOUT_MS,
      encoding: "utf8"
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(String(result.stderr || `Tika exited with ${result.status}`));
    }
    const stat = fsSync.existsSync(outputPath) ? fsSync.statSync(outputPath) : { size: 0 };
    return {
      parserTrace: [{
        stage,
        status: stat.size ? "completed" : "empty",
        runtime: "tika.app",
        command: runtime.command || "java",
        jarPath: runtime.jarPath || TIKA_APP_JAR,
        bytes: Number(metadata.byteSize || 0),
        outputBytes: stat.size
      }],
      warnings: stat.size ? [] : ["tika-empty"]
    };
  } catch (error) {
    return {
      parserTrace: [{
        stage,
        status: "failed",
        runtime: "tika.app",
        command: runtime.command || "java",
        jarPath: runtime.jarPath || TIKA_APP_JAR,
        error: error instanceof Error ? error.message : String(error)
      }],
      warnings: ["tika-failed"]
    };
  } finally {
    if (output !== null) {
      fsSync.closeSync(output);
    }
  }
}

function requiredRuntimeWarning(runtimeStatus = null, runtimeKeys = []) {
  const missing = runtimeKeys.filter((key) => !runtimeStatus?.runtimes?.[key]?.available);
  return missing.length ? `missing-runtime:${missing.join(",")}` : "";
}

function parseSuppliedContent({ route, metadata, text = "", buffer = null, runtimeStatus = null }) {
  const parserTrace = [];
  if (text) {
    parserTrace.push({ stage: "payload.text", status: "completed", characters: text.length });
    if (route?.id === "pdf") {
      const pdfProfile = buildPdfSubtypeProfile({
        source: "supplied-text",
        byteSize: metadata.byteSize || 0,
        textCharacters: text.length
      });
      parserTrace.push(pdfSubtypeTrace(pdfProfile));
      return { text, parserTrace, warnings: [], pdfProfile };
    }
    if (route?.id === "config") {
      const parsed = parseConfigText(text, metadata);
      parserTrace.push({
        stage: "config.key-value",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        entries: parsed.keyValueCount,
        sections: parsed.sectionCount,
        comments: parsed.commentCount,
        format: parsed.format
      });
      return { text: parsed.text || text, parserTrace, warnings: [] };
    }
    if (route?.id === "notebook") {
      const parsed = parseNotebookText(text);
      parserTrace.push({
        stage: "notebook.cells",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        cells: parsed.cellCount,
        markdownCells: parsed.markdownCount,
        codeCells: parsed.codeCount,
        outputs: parsed.outputCount,
        fallback: parsed.fallback
      });
      return { text: parsed.text || text, parserTrace, warnings: [] };
    }
    if (route?.id === "source-code") {
      const parsed = parseSourceCodeText(text, metadata);
      parserTrace.push({
        stage: "code.structure",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        language: parsed.language,
        lines: parsed.lineCount,
        imports: parsed.importCount,
        symbols: parsed.symbolCount,
        entryPoints: parsed.entryPointCount,
        todos: parsed.todoCount
      });
      return { text: parsed.text || text, parserTrace, warnings: [] };
    }
    if (route?.id === "diff") {
      const parsed = parseUnifiedDiffText(text);
      parserTrace.push({
        stage: "diff.unified",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        files: parsed.fileCount,
        hunks: parsed.hunkCount,
        additions: parsed.additions,
        deletions: parsed.deletions
      });
      return { text: parsed.text || text, parserTrace, warnings: [] };
    }
    if (route?.id === "calendar") {
      const parsed = parseCalendarText(text);
      parserTrace.push({
        stage: "calendar.ics",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        events: parsed.eventCount,
        todos: parsed.todoCount,
        from: parsed.from,
        to: parsed.to
      });
      return { text: parsed.text || text, parserTrace, warnings: [] };
    }
    if (route?.id === "transcript") {
      const parsed = parseTranscriptText(text, metadata);
      parserTrace.push({
        stage: "transcript.cues",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        cues: parsed.cueCount,
        speakers: parsed.speakerCount,
        from: parsed.from,
        to: parsed.to
      });
      parserTrace.push({
        stage: parsed.format === "srt" ? "transcript.srt" : "transcript.webvtt",
        status: parsed.cueCount ? "completed" : "empty",
        cues: parsed.cueCount
      });
      parserTrace.push({
        stage: "transcript.speaker-turns",
        status: parsed.speakerCount ? "completed" : "empty",
        speakers: parsed.speakerCount
      });
      return {
        text: parsed.text || text,
        parserTrace,
        warnings: [],
        structureElements: parsed.elements,
        structureFormat: parsed.format
      };
    }
    if (route?.id === "financial-report") {
      const parsed = parseXbrlText(text, metadata);
      parserTrace.push({
        stage: "xbrl.contexts",
        status: parsed.contextCount ? "completed" : "empty",
        contexts: parsed.contextCount
      });
      parserTrace.push({
        stage: "xbrl.facts",
        status: parsed.factCount ? "completed" : "empty",
        characters: parsed.text.length,
        facts: parsed.factCount,
        units: parsed.unitCount
      });
      return {
        text: parsed.text || text,
        parserTrace,
        warnings: [],
        structureElements: parsed.elements,
        structureFormat: parsed.format
      };
    }
    if (route?.id === "diagram") {
      const parsed = parseDiagramText(text, metadata);
      parserTrace.push({
        stage: "diagram.structure",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        nodes: parsed.nodeCount,
        edges: parsed.edgeCount,
        labels: parsed.labelCount,
        format: parsed.format
      });
      return { text: parsed.text || text, parserTrace, warnings: [] };
    }
    return { text, parserTrace, warnings: [] };
  }
  if (!buffer?.length) {
    parserTrace.push({ stage: "payload.decode", status: "skipped", reason: "no text or base64 payload supplied" });
    return { text: "", parserTrace, warnings: ["no-supplied-payload"] };
  }

  const plain = utf8(buffer);
  const warnings = [];
  parserTrace.push({ stage: "payload.decode", status: "completed", bytes: buffer.length });
  try {
    if (route?.id === "pdf") {
      const parsed = parsePdfBasicText(buffer);
      parserTrace.push(...parsed.parserTrace);
      warnings.push(...parsed.warnings);
      if (parsed.text) {
        const pdfProfile = buildPdfSubtypeProfile({
          source: "direct-payload",
          buffer,
          textCharacters: parsed.text.length,
          layoutBlocks: parsed.elements?.filter((element) => element.type === "pdf-text-block").length || 0,
          parserWarnings: warnings
        });
        parserTrace.push(pdfSubtypeTrace(pdfProfile));
        return {
          text: parsed.text,
          parserTrace,
          warnings,
          structureElements: parsed.elements || [],
          structureFormat: parsed.format || "pdf",
          pdfProfile
        };
      }
      parserTrace.push(runtimeStageTrace("pdf.visual.layout", runtimeStatus, "pdf.pymupdf"));
      parserTrace.push(runtimeStageTrace("ocr.page", runtimeStatus, "ocr.paddleocr"));
      const ocrResult = runPdfOcr(buffer, runtimeStatus);
      parserTrace.push(...ocrResult.parserTrace);
      warnings.push(...ocrResult.warnings);
      if (ocrResult.text) {
        const pdfProfile = buildPdfSubtypeProfile({
          source: "direct-payload",
          buffer,
          ocrCharacters: ocrResult.text.length,
          parserWarnings: warnings
        });
        parserTrace.push(pdfSubtypeTrace(pdfProfile));
        return { text: ocrResult.text, parserTrace, warnings, pdfProfile };
      }
      const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "pdf.text.tika");
      parserTrace.push(...tikaResult.parserTrace);
      warnings.push(...tikaResult.warnings);
      if (tikaResult.text) {
        const pdfProfile = buildPdfSubtypeProfile({
          source: "direct-payload",
          buffer,
          tikaCharacters: tikaResult.text.length,
          parserWarnings: warnings
        });
        parserTrace.push(pdfSubtypeTrace(pdfProfile));
        return { text: tikaResult.text, parserTrace, warnings, pdfProfile };
      }
      warnings.push(requiredRuntimeWarning(runtimeStatus, ["pdf.pymupdf", "pdf.poppler", "ocr.paddleocr", "ocr.tesseract"]) || "pdf-visual-or-ocr-runtime-required");
      const pdfProfile = buildPdfSubtypeProfile({
        source: "direct-payload",
        buffer,
        parserWarnings: warnings
      });
      parserTrace.push(pdfSubtypeTrace(pdfProfile));
      return { text: "", parserTrace, warnings, pdfProfile };
    }
    if (route?.id === "image") {
      const ocrResult = runImageOcr(buffer, metadata, runtimeStatus);
      parserTrace.push(...ocrResult.parserTrace);
      warnings.push(...ocrResult.warnings);
      if (ocrResult.text) {
        return { text: ocrResult.text, parserTrace, warnings };
      }
      parserTrace.push(runtimeStageTrace("multimodal.image", runtimeStatus, ""));
      warnings.push(requiredRuntimeWarning(runtimeStatus, ["ocr.tesseract"]) || "image-ocr-runtime-required");
      return { text: "", parserTrace, warnings };
    }
    if (route?.id === "audio") {
      parserTrace.push({
        stage: "audio.metadata",
        status: "completed",
        bytes: buffer.length,
        mediaType: metadata.mediaType || "",
        extension: metadata.extension || "",
        strategy: "audio-route-no-inline-binary-to-text.v1"
      });
      parserTrace.push({
        stage: "audio.transcript-sidecar",
        status: "requires-input",
        expectedSidecarFormats: [".vtt", ".srt", ".json", ".txt"]
      });
      parserTrace.push({
        stage: "audio.asr.external",
        status: "requires-external-runtime"
      });
      warnings.push("audio-transcript-or-asr-runtime-required");
      return { text: "", parserTrace, warnings };
    }
    if (route?.id === "json") {
      const parsed = parseJsonLike(plain);
      parserTrace.push({ stage: "structured.json", status: "completed", characters: parsed.length });
      return { text: parsed, parserTrace, warnings };
    }
    if (route?.id === "notebook") {
      const parsed = parseNotebookText(plain);
      parserTrace.push({
        stage: "notebook.cells",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        cells: parsed.cellCount,
        markdownCells: parsed.markdownCount,
        codeCells: parsed.codeCount,
        outputs: parsed.outputCount,
        fallback: parsed.fallback
      });
      return { text: parsed.text || plain.trim(), parserTrace, warnings };
    }
    if (route?.id === "source-code") {
      const parsed = parseSourceCodeText(plain, metadata);
      parserTrace.push({
        stage: "code.structure",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        language: parsed.language,
        lines: parsed.lineCount,
        imports: parsed.importCount,
        symbols: parsed.symbolCount,
        entryPoints: parsed.entryPointCount,
        todos: parsed.todoCount
      });
      return { text: parsed.text || plain.trim(), parserTrace, warnings };
    }
    if (route?.id === "diff") {
      const parsed = parseUnifiedDiffText(plain);
      parserTrace.push({
        stage: "diff.unified",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        files: parsed.fileCount,
        hunks: parsed.hunkCount,
        additions: parsed.additions,
        deletions: parsed.deletions
      });
      return { text: parsed.text || plain.trim(), parserTrace, warnings };
    }
    if (route?.id === "calendar") {
      const parsed = parseCalendarText(plain);
      parserTrace.push({
        stage: "calendar.ics",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        events: parsed.eventCount,
        todos: parsed.todoCount,
        from: parsed.from,
        to: parsed.to
      });
      return { text: parsed.text || plain.trim(), parserTrace, warnings };
    }
    if (route?.id === "transcript") {
      const parsed = parseTranscriptText(plain, metadata);
      parserTrace.push({
        stage: "transcript.cues",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        cues: parsed.cueCount,
        speakers: parsed.speakerCount,
        from: parsed.from,
        to: parsed.to
      });
      parserTrace.push({
        stage: parsed.format === "srt" ? "transcript.srt" : "transcript.webvtt",
        status: parsed.cueCount ? "completed" : "empty",
        cues: parsed.cueCount
      });
      parserTrace.push({
        stage: "transcript.speaker-turns",
        status: parsed.speakerCount ? "completed" : "empty",
        speakers: parsed.speakerCount
      });
      return {
        text: parsed.text || plain.trim(),
        parserTrace,
        warnings,
        structureElements: parsed.elements,
        structureFormat: parsed.format
      };
    }
    if (route?.id === "financial-report") {
      const parsed = parseXbrlText(plain, metadata);
      parserTrace.push({
        stage: "xbrl.contexts",
        status: parsed.contextCount ? "completed" : "empty",
        contexts: parsed.contextCount
      });
      parserTrace.push({
        stage: "xbrl.facts",
        status: parsed.factCount ? "completed" : "empty",
        characters: parsed.text.length,
        facts: parsed.factCount,
        units: parsed.unitCount
      });
      return {
        text: parsed.text || plain.trim(),
        parserTrace,
        warnings,
        structureElements: parsed.elements,
        structureFormat: parsed.format
      };
    }
    if (route?.id === "markup") {
      const parsed = parseMarkupText(plain, metadata);
      parserTrace.push({
        stage: "markup.structure",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        format: parsed.format,
        elements: parsed.elementCount,
        headings: parsed.headingCount,
        listItems: parsed.listItemCount,
        links: parsed.linkCount,
        tables: parsed.tableCount,
        codeBlocks: parsed.codeBlockCount,
        formulas: parsed.formulaCount
      });
      return {
        text: parsed.text || plain.trim(),
        parserTrace,
        warnings,
        structureElements: parsed.elements,
        structureFormat: parsed.format
      };
    }
    if (route?.id === "config") {
      const parsed = parseConfigText(plain, metadata);
      parserTrace.push({
        stage: "config.key-value",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        entries: parsed.keyValueCount,
        sections: parsed.sectionCount,
        comments: parsed.commentCount,
        format: parsed.format
      });
      return { text: parsed.text || plain.trim(), parserTrace, warnings };
    }
    if (route?.id === "diagram") {
      const parsed = parseDiagramText(plain, metadata);
      parserTrace.push({
        stage: "diagram.structure",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        nodes: parsed.nodeCount,
        edges: parsed.edgeCount,
        labels: parsed.labelCount,
        format: parsed.format
      });
      return { text: parsed.text || plain.trim(), parserTrace, warnings };
    }
    if (route?.id === "spreadsheet" && (metadata.extension === ".csv" || metadata.mediaType === "text/csv")) {
      const parsed = parseDelimitedText(plain, ",");
      parserTrace.push({ stage: "table.csv", status: "completed", characters: parsed.length });
      return { text: parsed, parserTrace, warnings };
    }
    if (route?.id === "spreadsheet" && (metadata.extension === ".tsv" || metadata.mediaType === "text/tab-separated-values")) {
      const parsed = parseDelimitedText(plain, "\t");
      parserTrace.push({ stage: "table.tsv", status: "completed", characters: parsed.length });
      return { text: parsed, parserTrace, warnings };
    }
    if (route?.id === "email") {
      if (isMsgRoute(route, metadata)) {
        const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "email.msg.tika");
        parserTrace.push(...tikaResult.parserTrace);
        warnings.push(...tikaResult.warnings);
        if (tikaResult.text) {
          return { text: tikaResult.text, parserTrace, warnings };
        }
        warnings.push(requiredRuntimeWarning(runtimeStatus, ["tika.app"]) || "msg-tika-empty");
        return { text: "", parserTrace, warnings };
      }
      if (isMboxRoute(route, metadata)) {
        const parsed = parseMboxText(plain);
        parserTrace.push({
          stage: "email.mbox",
          status: parsed.messages.length ? "completed" : "empty",
          messages: parsed.messages.length,
          maxMessages: EMAIL_MBOX_MAX_MESSAGES,
          truncated: parsed.messages.length >= EMAIL_MBOX_MAX_MESSAGES
        });
        return { text: parsed.text, parserTrace, warnings };
      }
      const parsed = parseEmailText(plain);
      parserTrace.push({ stage: "email.headers-body", status: "completed", characters: parsed.length });
      return { text: parsed, parserTrace, warnings };
    }
    if (route?.id === "markdown") {
      const parsed = parseMarkdownText(plain, metadata);
      parserTrace.push({ stage: "text.markdown", status: "completed", characters: plain.trim().length });
      parserTrace.push({
        stage: "markdown.frontmatter",
        status: parsed.frontmatterCount ? "completed" : "empty",
        fields: parsed.frontmatterCount,
        frontmatter: parsed.frontmatterCount,
        strategy: "markdown-frontmatter-key-value.v1"
      });
      parserTrace.push({
        stage: "markdown.structure",
        status: parsed.text ? "completed" : "empty",
        characters: parsed.text.length,
        elements: parsed.elements.length,
        headings: parsed.headingCount,
        listItems: parsed.listItemCount,
        tables: parsed.tableCount,
        codeBlocks: parsed.codeBlockCount,
        blockquotes: parsed.blockquoteCount,
        links: parsed.linkCount,
        images: parsed.imageCount,
        metadata: parsed.metadataCount
      });
      return {
        text: parsed.text || plain.trim(),
        parserTrace,
        warnings,
        structureElements: parsed.elements,
        structureFormat: parsed.format
      };
    }
    if (["plain-text", "source-code"].includes(route?.id)) {
      const parsed = plain.trim();
      parserTrace.push({ stage: "text.direct", status: "completed", characters: parsed.length });
      return { text: parsed, parserTrace, warnings };
    }
    if (["word", "presentation", "visio", "spreadsheet", "open-document", "ebook"].includes(route?.id)) {
      const entries = readZipEntries(buffer);
      parserTrace.push({ stage: "zip.container", status: entries.length ? "completed" : "failed", entries: entries.length });
      if (route.id === "word") {
        const parsed = parseDocx(entries);
        parserTrace.push({
          stage: "office.word.structured",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          paragraphs: parsed.paragraphCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          contentControls: parsed.contentControlCount,
          bookmarks: parsed.bookmarkCount,
          annotations: parsed.annotationCount,
          comments: parsed.commentCount,
          footnotes: parsed.footnoteCount,
          endnotes: parsed.endnoteCount,
          revisions: parsed.revisionCount,
          insertedRevisions: parsed.insertionRevisionCount,
          deletedRevisions: parsed.deletionRevisionCount,
          links: parsed.hyperlinkCount,
          images: parsed.imageCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          headings: parsed.headingCount,
          listItems: parsed.listItemCount,
          styles: parsed.styleRefCount,
          numberingRefs: parsed.numberingRefCount
        });
        parserTrace.push({
          stage: "office.word.styles",
          status: parsed.styleRefCount ? "completed" : "empty",
          styles: parsed.styleRefCount,
          headings: parsed.headingCount,
          listItems: parsed.listItemCount
        });
        parserTrace.push({
          stage: "office.word.numbering",
          status: parsed.numberingRefCount ? "completed" : "empty",
          numberingRefs: parsed.numberingRefCount,
          listItems: parsed.listItemCount
        });
        parserTrace.push({
          stage: "office.word.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount
        });
        parserTrace.push({
          stage: "office.word.headers-footers",
          status: parsed.headerFooterElementCount ? "completed" : "empty",
          headerParts: parsed.headerPartCount,
          footerParts: parsed.footerPartCount,
          headerFooters: parsed.headerFooterElementCount,
          headers: parsed.headerElementCount,
          footers: parsed.footerElementCount
        });
        parserTrace.push({
          stage: "office.word.content-controls",
          status: parsed.contentControlCount ? "completed" : "empty",
          contentControls: parsed.contentControlCount
        });
        parserTrace.push({
          stage: "office.word.bookmarks",
          status: parsed.bookmarkCount ? "completed" : "empty",
          bookmarks: parsed.bookmarkCount
        });
        parserTrace.push({
          stage: "office.word.annotations",
          status: parsed.annotationCount ? "completed" : "empty",
          annotations: parsed.annotationCount,
          comments: parsed.commentCount,
          footnotes: parsed.footnoteCount,
          endnotes: parsed.endnoteCount
        });
        parserTrace.push({
          stage: "office.word.revisions",
          status: parsed.revisionCount ? "completed" : "empty",
          revisions: parsed.revisionCount,
          inserted: parsed.insertionRevisionCount,
          deleted: parsed.deletionRevisionCount
        });
        parserTrace.push({
          stage: "office.word.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          links: parsed.hyperlinkCount
        });
        parserTrace.push({
          stage: "office.word.images",
          status: parsed.imageCount ? "completed" : "empty",
          images: parsed.imageCount
        });
        parserTrace.push({
          stage: "office.word.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        });
        if (parsed.text) {
          return {
            text: parsed.text,
            parserTrace,
            warnings,
            structureElements: parsed.elements,
            structureFormat: parsed.format
          };
        }
        const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "tika.text");
        parserTrace.push(...tikaResult.parserTrace);
        warnings.push(...tikaResult.warnings);
        return { text: tikaResult.text, parserTrace, warnings };
      }
      if (route.id === "presentation") {
        const parsed = parsePptx(entries);
        parserTrace.push({
          stage: "office.presentation.slides",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          slides: parsed.slideCount,
          shapes: parsed.shapeCount,
          placeholders: parsed.placeholderCount,
          shapeMetadata: parsed.shapeMetadataCount,
          geometries: parsed.geometryCount,
          shapeGeometries: parsed.shapeGeometryCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          tableGeometries: parsed.tableGeometryCount,
          speakerNotes: parsed.speakerNoteCount,
          comments: parsed.commentCount,
          commentParts: parsed.commentPartCount,
          commentAuthors: parsed.commentAuthorCount,
          slideLayouts: parsed.slideLayoutPartCount,
          slideMasters: parsed.slideMasterPartCount,
          layoutRefs: parsed.slideLayoutRefCount,
          masterRefs: parsed.slideMasterRefCount,
          hyperlinks: parsed.hyperlinkCount,
          images: parsed.imageCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          chartGeometries: parsed.chartGeometryCount,
          layoutStrategy: parsed.shapeGeometryCount ? "presentationml-shape-geometry.v1" : "",
          headings: parsed.headingCount,
          paragraphs: parsed.paragraphCount
        });
        parserTrace.push({
          stage: "office.presentation.layouts",
          status: parsed.slideLayoutRefCount || parsed.slideMasterRefCount ? "completed" : "empty",
          slideLayouts: parsed.slideLayoutPartCount,
          slideMasters: parsed.slideMasterPartCount,
          layoutRefs: parsed.slideLayoutRefCount,
          masterRefs: parsed.slideMasterRefCount
        });
        parserTrace.push({
          stage: "office.presentation.placeholders",
          status: parsed.placeholderCount ? "completed" : "empty",
          placeholders: parsed.placeholderCount,
          shapeMetadata: parsed.shapeMetadataCount
        });
        parserTrace.push({
          stage: "office.presentation.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount,
          geometries: parsed.tableGeometryCount,
          layoutStrategy: parsed.tableGeometryCount ? "presentationml-table-geometry.v1" : ""
        });
        parserTrace.push({
          stage: "office.presentation.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          links: parsed.hyperlinkCount
        });
        parserTrace.push({
          stage: "office.presentation.images",
          status: parsed.imageCount ? "completed" : "empty",
          images: parsed.imageCount,
          geometries: parsed.imageGeometryCount
        });
        parserTrace.push({
          stage: "office.presentation.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          geometries: parsed.chartGeometryCount
        });
        parserTrace.push({
          stage: "office.presentation.speaker-notes",
          status: parsed.speakerNoteCount ? "completed" : "empty",
          notes: parsed.speakerNoteCount
        });
        parserTrace.push({
          stage: "office.presentation.comments",
          status: parsed.commentCount ? "completed" : "empty",
          comments: parsed.commentCount,
          commentParts: parsed.commentPartCount,
          authors: parsed.commentAuthorCount
        });
        if (parsed.text) {
          return {
            text: parsed.text,
            parserTrace,
            warnings,
            structureElements: parsed.elements,
            structureFormat: parsed.format
          };
        }
        const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "tika.text");
        parserTrace.push(...tikaResult.parserTrace);
        warnings.push(...tikaResult.warnings);
        return { text: tikaResult.text, parserTrace, warnings };
      }
      if (route.id === "visio") {
        const parsed = parseVisio(entries);
        parserTrace.push({
          stage: "office.visio.pages",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          pages: parsed.pageCount,
          shapes: parsed.shapeCount,
          textShapes: parsed.textShapeCount,
          connectors: parsed.connectorCount,
          geometries: parsed.geometryCount
        });
        parserTrace.push({
          stage: "office.visio.shapes",
          status: parsed.shapeCount ? "completed" : "empty",
          shapes: parsed.shapeCount,
          textShapes: parsed.textShapeCount,
          geometries: parsed.geometryCount,
          layoutStrategy: parsed.geometryCount ? "visio-shape-geometry.v1" : ""
        });
        parserTrace.push({
          stage: "office.visio.connectors",
          status: parsed.connectorCount ? "completed" : "empty",
          connectors: parsed.connectorCount
        });
        if (parsed.text) {
          return {
            text: parsed.text,
            parserTrace,
            warnings,
            structureElements: parsed.elements,
            structureFormat: parsed.format
          };
        }
        const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "tika.text");
        parserTrace.push(...tikaResult.parserTrace);
        warnings.push(...tikaResult.warnings);
        return { text: tikaResult.text, parserTrace, warnings };
      }
      if (route.id === "spreadsheet") {
        const parsed = parseXlsxDetailed(entries);
        parserTrace.push({
          stage: "table.sheet.structured",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          sheets: parsed.sheetCount,
          workbookSheets: parsed.workbookSheetCount,
          sheetRefs: parsed.sheetRefCount,
          hiddenSheets: parsed.hiddenSheetCount,
          definedNames: parsed.definedNameCount,
          namedRanges: parsed.namedRangeCount,
          printAreas: parsed.printAreaCount,
          rows: parsed.rowCount,
          cells: parsed.cellCount,
          dateStyles: parsed.dateStyleCount,
          dateCells: parsed.dateCellCount,
          mergedCells: parsed.mergedCellCount,
          comments: parsed.commentCount,
          formulas: parsed.formulaCount,
          hyperlinks: parsed.hyperlinkCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        });
        parserTrace.push({
          stage: "table.workbook.sheets",
          status: parsed.workbookSheetCount ? "completed" : "empty",
          sheets: parsed.workbookSheetCount,
          sheetRefs: parsed.sheetRefCount,
          hiddenSheets: parsed.hiddenSheetCount
        });
        parserTrace.push({
          stage: "table.workbook.defined-names",
          status: parsed.definedNameCount ? "completed" : "empty",
          definedNames: parsed.definedNameCount,
          namedRanges: parsed.namedRangeCount,
          printAreas: parsed.printAreaCount
        });
        parserTrace.push({
          stage: "table.sheet.headers",
          status: parsed.headerRows ? "completed" : "empty",
          headerRows: parsed.headerRows
        });
        parserTrace.push({
          stage: "table.sheet.cells",
          status: parsed.cellCount ? "completed" : "empty",
          cells: parsed.cellCount,
          sharedStrings: parsed.sharedStringCount
        });
        parserTrace.push({
          stage: "table.sheet.merged-cells",
          status: parsed.mergedCellCount ? "completed" : "empty",
          mergedCells: parsed.mergedCellCount
        });
        parserTrace.push({
          stage: "table.sheet.comments",
          status: parsed.commentCount ? "completed" : "empty",
          comments: parsed.commentCount
        });
        parserTrace.push({
          stage: "table.sheet.date-styles",
          status: parsed.dateCellCount ? "completed" : parsed.dateStyleCount ? "empty" : "not_applicable",
          dateStyles: parsed.dateStyleCount,
          dateCells: parsed.dateCellCount
        });
        parserTrace.push({
          stage: "table.sheet.formulas",
          status: parsed.formulaCount ? "completed" : "empty",
          formulas: parsed.formulaCount
        });
        parserTrace.push({
          stage: "table.sheet.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          hyperlinks: parsed.hyperlinkCount
        });
        parserTrace.push({
          stage: "table.sheet.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        });
        if (parsed.text) {
          return {
            text: parsed.text,
            parserTrace,
            warnings,
            structureElements: parsed.elements,
            structureFormat: parsed.format
          };
        }
        const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "tika.text");
        parserTrace.push(...tikaResult.parserTrace);
        warnings.push(...tikaResult.warnings);
        return { text: tikaResult.text, parserTrace, warnings };
      }
      if (route.id === "open-document") {
        const parsed = parseOpenDocument(entries);
        parserTrace.push({
          stage: "open-document.structured",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          headings: parsed.headingCount,
          paragraphs: parsed.paragraphCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          links: parsed.linkCount
        });
        parserTrace.push({
          stage: "open-document.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount
        });
        parserTrace.push({
          stage: "open-document.hyperlinks",
          status: parsed.linkCount ? "completed" : "empty",
          links: parsed.linkCount
        });
        if (parsed.text) {
          return {
            text: parsed.text,
            parserTrace,
            warnings,
            structureElements: parsed.elements,
            structureFormat: parsed.format
          };
        }
        const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "tika.text");
        parserTrace.push(...tikaResult.parserTrace);
        warnings.push(...tikaResult.warnings);
        return { text: tikaResult.text, parserTrace, warnings };
      }
      if (route.id === "ebook") {
        const parsed = parseEpub(entries);
        parserTrace.push({
          stage: "ebook.epub",
          status: parsed.text ? "completed" : "empty",
          characters: parsed.text.length,
          elements: parsed.elements.length,
          chapters: parsed.chapterCount,
          headings: parsed.headingCount,
          paragraphs: parsed.paragraphCount,
          tableRows: parsed.tableRowCount,
          links: parsed.linkCount
        });
        if (parsed.text) {
          return {
            text: parsed.text,
            parserTrace,
            warnings,
            structureElements: parsed.elements,
            structureFormat: parsed.format
          };
        }
        const tikaResult = runTikaText(buffer, metadata, runtimeStatus, "tika.text");
        parserTrace.push(...tikaResult.parserTrace);
        warnings.push(...tikaResult.warnings);
        return { text: tikaResult.text, parserTrace, warnings };
      }
    }
    if (route?.id === "archive") {
      const extracted = extractArchiveEntries(buffer, metadata, runtimeStatus);
      parserTrace.push(...extracted.parserTrace);
      warnings.push(...extracted.warnings);
      const parsed = parseArchiveManifest(extracted.entries);
      parserTrace.push({ stage: "archive.manifest", status: parsed ? "completed" : "empty", characters: parsed.length });
      return { text: parsed, parserTrace, warnings };
    }
    parserTrace.push({ stage: route?.preferredParser || "unsupported.format", status: "requires-external-runtime" });
    warnings.push("parser-runtime-required");
    return { text: "", parserTrace, warnings };
  } catch (error) {
    parserTrace.push({ stage: route?.preferredParser || "payload.parse", status: "failed", error: error instanceof Error ? error.message : String(error) });
    return { text: "", parserTrace, warnings: [...warnings, "payload-parse-failed"] };
  }
}

function normalizeDocumentMetadata(document = {}, metadata = {}, title = "", text = "") {
  const fileName = String(
    document.fileName ||
      document.filename ||
      document.name ||
      document.path ||
      document.relativePath ||
      metadata.fileName ||
      metadata.filename ||
      metadata.path ||
      title ||
      ""
  ).trim();
  const extension = normalizeExtension(
      document.extension ||
      document.ext ||
      metadata.extension ||
      extensionFromFileName(fileName)
  );
  const mediaType = String(
    document.mediaType ||
      document.mimeType ||
      document.contentType ||
      metadata.mediaType ||
      metadata.mimeType ||
      metadata.contentType ||
      inferMediaTypeFromExtension(extension) ||
      ""
  ).trim().toLowerCase();
  const byteSize = normalizeByteSize(
    document.byteSize ?? document.size ?? metadata.byteSize ?? metadata.size,
    text
  );
  return {
    fileName: fileName || title,
    relativePath: String(document.relativePath || metadata.relativePath || fileName || title).trim(),
    extension,
    mediaType,
    byteSize,
    sourceKind: String(document.sourceKind || metadata.sourceKind || "document").trim() || "document",
    manifestLine: Number(document.manifestLine || metadata.manifestLine || 0),
    language: String(document.language || metadata.language || "").trim(),
    eventTime: String(document.eventTime || metadata.eventTime || "").trim(),
    documentTime: String(document.documentTime || metadata.documentTime || document.capturedAt || metadata.capturedAt || "").trim()
  };
}

function metadataForArchiveEntry(entry = {}, parentDocument = {}) {
  const fileName = path.basename(entry.name || "") || "archive-entry";
  const extension = normalizeExtension(path.extname(fileName));
  const mediaType = inferMediaTypeFromExtension(extension);
  return {
    fileName,
    relativePath: `${parentDocument.relativePath || parentDocument.fileName || parentDocument.sourceId}!/${entry.name}`,
    extension,
    mediaType,
    byteSize: entry.uncompressedSize || entry.data?.length || 0,
    sourceKind: "archive-entry",
    language: "",
    eventTime: parentDocument.eventTime || "",
    documentTime: parentDocument.documentTime || parentDocument.capturedAt || ""
  };
}

function metadataForEmailAttachment(attachment = {}, parentDocument = {}) {
  const fileName = path.basename(attachment.fileName || "") || "attachment.bin";
  const extension = normalizeExtension(path.extname(fileName));
  const mediaType = String(attachment.mediaType || inferMediaTypeFromExtension(extension) || "application/octet-stream").toLowerCase();
  return {
    fileName,
    relativePath: `${parentDocument.relativePath || parentDocument.fileName || parentDocument.sourceId}!/${fileName}`,
    extension,
    mediaType,
    byteSize: attachment.data?.length || 0,
    sourceKind: "email-attachment",
    language: "",
    eventTime: parentDocument.eventTime || "",
    documentTime: parentDocument.documentTime || parentDocument.capturedAt || ""
  };
}

function lookupFormatRoute({ extension = "", mediaType = "", text = "" } = {}) {
  const normalizedExtension = normalizeExtension(extension);
  if (ROUTES_BY_EXTENSION.has(normalizedExtension)) {
    return ROUTES_BY_EXTENSION.get(normalizedExtension);
  }
  const normalizedMediaType = String(mediaType || "").toLowerCase();
  if (ROUTES_BY_MEDIA_TYPE.has(normalizedMediaType)) {
    return ROUTES_BY_MEDIA_TYPE.get(normalizedMediaType);
  }
  if (normalizedMediaType.startsWith("text/")) {
    return ROUTES_BY_MEDIA_TYPE.get("text/plain");
  }
  if (normalizedMediaType.startsWith("image/")) {
    return ROUTES_BY_EXTENSION.get(".png");
  }
  if (normalizedMediaType.startsWith("audio/")) {
    return ROUTES_BY_EXTENSION.get(".wav");
  }
  if (normalizedMediaType === "inode/directory" || normalizedMediaType === "application/x-directory") {
    return ROUTES_BY_MEDIA_TYPE.get("inode/directory");
  }
  if (text) {
    return ROUTES_BY_MEDIA_TYPE.get("text/plain");
  }
  return null;
}

function buildDocumentRoute(document = {}) {
  const route = lookupFormatRoute(document);
  const riskFlags = [];
  if (!route) {
    riskFlags.push("unknown-format");
  }
  const textCharacters = Number(document.totalTextCharacters || (document.text || "").length || 0);
  if ((document.byteSize || 0) >= LARGE_FILE_BYTES || textCharacters >= LARGE_TEXT_CHARACTERS) {
    riskFlags.push("large-file-risk");
  }
  if (route?.id === "pdf" && !document.text) {
    riskFlags.push("pdf-needs-text-extraction");
  }
  if (route?.id === "pdf" && document.text && document.text.length < 800) {
    riskFlags.push("pdf-low-text-density");
  }
  if (route?.id === "pdf" && document.pdfProfile?.riskFlags?.length) {
    riskFlags.push(...document.pdfProfile.riskFlags);
  }
  if (route?.id === "image") {
    riskFlags.push("ocr-required");
  }
  if (route?.id === "archive") {
    riskFlags.push("archive-expansion-required");
  }
  if (route?.id === "directory") {
    riskFlags.push("directory-expansion-required");
  }
  if (!document.text && textCharacters <= 0) {
    riskFlags.push("no-supplied-text");
  }
  return {
    sourceId: document.sourceId,
    parentSourceId: document.parentSourceId || "",
    archivePath: document.archivePath || "",
    archiveDepth: Number(document.archiveDepth || 0),
    title: document.title,
    fileName: document.fileName,
    relativePath: document.relativePath,
    extension: document.extension,
    mediaType: document.mediaType,
    byteSize: document.byteSize,
    declaredType: document.mediaType || document.extension || "unknown",
    declaredExtension: document.declaredExtension || document.extension || "",
    declaredMediaType: document.declaredMediaType || document.mediaType || "",
    sniffedType: route?.mediaTypes?.[0] || document.mediaType || "unknown",
    sniffedExtension: document.sniffedExtension || document.extension || "",
    sniffedMediaType: document.sniffedMediaType || route?.mediaTypes?.[0] || document.mediaType || "",
    contentSignature: document.contentSignature || "",
    contentSignatureConfidence: Number(document.contentSignatureConfidence || 0),
    formatId: route?.id || "unknown",
    pdfSubtype: route?.id === "pdf" ? document.pdfProfile?.subtype || "" : "",
    pdfSubtypeStrategy: route?.id === "pdf" ? document.pdfProfile?.strategy || PDF_SUBTYPE_ROUTING_STRATEGY : "",
    contentShape: route?.contentShape || "unknown",
    preferredParser: route?.preferredParser || "unsupported.format",
    fallbackParsers: route?.fallbackParsers || [],
    parserChain: route?.parserChain || ["unsupported.route"],
    streamingUnit: route?.streamingUnit || "document",
    riskFlags,
    referenceFrameworks: route?.referenceFrameworks || ["unstructured", "haystack"]
  };
}

function normalizedWindowOptions(options = {}) {
  const maxCharacters = Math.max(
    1000,
    Math.min(200_000, Number(options.maxWindowCharacters || DEFAULT_WINDOW_CHARACTERS) || DEFAULT_WINDOW_CHARACTERS)
  );
  const overlapCharacters = Math.max(
    0,
    Math.min(maxCharacters - 1, Number(options.windowOverlapCharacters || DEFAULT_WINDOW_OVERLAP_CHARACTERS) || 0)
  );
  return { maxCharacters, overlapCharacters };
}

function selectWindowEnd(text = "", maxCharacters = DEFAULT_WINDOW_CHARACTERS) {
  const hardEnd = Math.min(text.length, maxCharacters);
  if (hardEnd >= text.length) {
    return hardEnd;
  }
  const searchStart = Math.max(Math.floor(maxCharacters * 0.65), 0);
  const boundary = Math.max(
    text.lastIndexOf("\n\n", hardEnd),
    text.lastIndexOf("\n# ", hardEnd),
    text.lastIndexOf("。", hardEnd),
    text.lastIndexOf(". ", hardEnd)
  );
  return boundary > searchStart ? boundary + 1 : hardEnd;
}

function buildWindowRecord(document = {}, index = 0, startOffset = 0, endOffset = 0, chunk = "") {
  const inferredTime = inferTimeMetadataFromText(chunk);
  return {
    windowId: stableId("window", document.sourceId, String(index + 1), chunk),
    sourceId: document.sourceId,
    index,
    startOffset,
    endOffset,
    charCount: chunk.length,
    contentHash: `sha256:${sha(chunk)}`,
    excerpt: firstSentence(chunk),
    ...(inferredTime.timeRange ? {
      timeRange: inferredTime.timeRange,
      timeConfidence: inferredTime.timeConfidence,
      timeSignals: inferredTime.timeSignals
    } : {})
  };
}

function structureElementLine(element = {}) {
  const level = element.level ? ` level ${element.level}` : "";
  const line = element.line ? ` line ${element.line}` : "";
  const name = element.name ? ` ${element.name}` : "";
  const href = element.href ? ` -> ${element.href}` : "";
  const style = element.style?.styleId ? ` style ${element.style.styleId}` : "";
  const numbering = element.style?.numberingId ? ` num ${element.style.numberingId}:${element.style.numberingLevel || 0}` : "";
  const shape = element.shape?.id || element.shape?.name
    ? ` shape ${[element.shape.id, element.shape.name].filter(Boolean).join(":")}`
    : "";
  const image = element.image?.relationshipId || element.image?.target
    ? ` image ${[element.image.relationshipId, element.image.target].filter(Boolean).join(":")}`
    : "";
  const chart = element.chart?.relationshipId || element.chart?.chartPart || element.chart?.title
    ? ` chart ${[element.chart.relationshipId, element.chart.title || element.chart.chartPart].filter(Boolean).join(":")}`
    : "";
  const form = element.form?.name || element.form?.value
    ? ` form ${[element.form.name, element.form.value].filter(Boolean).join(":")}`
    : "";
  const control = element.control?.alias || element.control?.tag || element.control?.id
    ? ` control ${[element.control.alias || element.control.tag, element.control.id].filter(Boolean).join(":")}`
    : "";
  const bookmark = element.bookmark?.name
    ? ` bookmark ${element.bookmark.name}`
    : "";
  const headerFooter = element.headerFooter?.kind
    ? ` ${element.headerFooter.kind} ${element.headerFooter.partName || ""}`
    : "";
  const presentation = element.presentation?.kind
    ? ` ${element.presentation.kind} ${[element.presentation.layoutPart, element.presentation.masterPart].filter(Boolean).join(" -> ")}`
    : "";
  const definedName = element.definedName?.name || element.definedName?.ref
    ? ` defined-name ${[element.definedName.displayName || element.definedName.name, element.definedName.ref].filter(Boolean).join("=")}`
    : "";
  const codeBlock = element.codeBlock?.language || element.codeBlock?.lineStart
    ? ` code ${[element.codeBlock.language || "", element.codeBlock.lineStart ? `L${element.codeBlock.lineStart}` : ""].filter(Boolean).join(":")}`
    : "";
  const quote = element.quote?.depth
    ? ` quote depth ${element.quote.depth}`
    : "";
  const merge = element.merge?.ref
    ? ` merge ${element.merge.ref}${element.merge.masterRef ? ` master ${element.merge.masterRef}` : ""}`
    : "";
  const placeholder = element.shape?.placeholderType
    ? ` placeholder ${element.shape.placeholderType}${element.shape.placeholderIndex ? `#${element.shape.placeholderIndex}` : ""}`
    : element.shape?.isPlaceholder
      ? " placeholder"
      : "";
  return `Element ${element.type}${level}${name}${line}${style}${numbering}${shape}${placeholder}${image}${chart}${form}${control}${bookmark}${headerFooter}${presentation}${definedName}${codeBlock}${quote}${merge}: ${element.text}${href}`;
}

function structureElementTypeCounts(elements = []) {
  const counts = {};
  for (const element of elements) {
    counts[element.type] = (counts[element.type] || 0) + 1;
  }
  return counts;
}

function normalizedStructureElements(document = {}) {
  const elements = Array.isArray(document.structureElements) ? document.structureElements : [];
  return elements
    .map((element, index) => {
      const page = Number(element.page || element.layout?.page || 0);
      const bbox = element.bbox && typeof element.bbox === "object"
        ? {
            x: roundLayoutNumber(element.bbox.x),
            y: roundLayoutNumber(element.bbox.y),
            width: roundLayoutNumber(element.bbox.width),
            height: roundLayoutNumber(element.bbox.height)
          }
        : null;
      const layout = element.layout && typeof element.layout === "object"
        ? {
            strategy: String(element.layout.strategy || ""),
            page: Number(element.layout.page || page || 0),
            streamIndex: Number(element.layout.streamIndex || 0),
            order: Number(element.layout.order || 0),
            x: roundLayoutNumber(element.layout.x),
            y: roundLayoutNumber(element.layout.y),
            width: roundLayoutNumber(element.layout.width),
            height: roundLayoutNumber(element.layout.height),
            fontSize: roundLayoutNumber(element.layout.fontSize)
          }
        : null;
      const table = element.table && typeof element.table === "object"
        ? {
            format: String(element.table.format || ""),
            sheet: String(element.table.sheet || ""),
            sheetName: String(element.table.sheetName || ""),
            sheetId: String(element.table.sheetId || ""),
            sheetState: String(element.table.sheetState || ""),
            relationshipId: String(element.table.relationshipId || ""),
            worksheetPath: String(element.table.worksheetPath || ""),
            position: Number(element.table.position || 0),
            row: Number(element.table.row || 0),
            columns: Number(element.table.columns || 0)
          }
        : null;
      const annotation = element.annotation && typeof element.annotation === "object"
        ? {
            kind: String(element.annotation.kind || ""),
            id: String(element.annotation.id || ""),
            author: String(element.annotation.author || ""),
            date: String(element.annotation.date || ""),
            type: String(element.annotation.type || ""),
            sourcePart: String(element.annotation.sourcePart || "")
          }
        : null;
      const style = element.style && typeof element.style === "object"
        ? {
            styleId: String(element.style.styleId || ""),
            numberingId: String(element.style.numberingId || ""),
            numberingLevel: Number(element.style.numberingLevel || 0),
            listLevel: Number(element.style.listLevel || 0)
          }
        : null;
      const shape = element.shape && typeof element.shape === "object"
        ? {
            id: String(element.shape.id || ""),
            name: String(element.shape.name || ""),
            slide: Number(element.shape.slide || page || 0),
            order: Number(element.shape.order || 0),
            type: String(element.shape.type || ""),
            master: String(element.shape.master || ""),
            masterShape: String(element.shape.masterShape || ""),
            isPlaceholder: Boolean(element.shape.isPlaceholder),
            placeholderType: String(element.shape.placeholderType || ""),
            placeholderIndex: String(element.shape.placeholderIndex || ""),
            placeholderSize: String(element.shape.placeholderSize || "")
          }
        : null;
      const presentation = element.presentation && typeof element.presentation === "object"
        ? {
            kind: String(element.presentation.kind || ""),
            slide: Number(element.presentation.slide || page || 0),
            slidePart: String(element.presentation.slidePart || ""),
            layoutPart: String(element.presentation.layoutPart || ""),
            masterPart: String(element.presentation.masterPart || ""),
            relationshipId: String(element.presentation.relationshipId || element.presentation.layoutRelationshipId || ""),
            layoutRelationshipId: String(element.presentation.layoutRelationshipId || element.presentation.relationshipId || ""),
            layoutRelationshipType: String(element.presentation.layoutRelationshipType || ""),
            masterRelationshipId: String(element.presentation.masterRelationshipId || ""),
            masterRelationshipType: String(element.presentation.masterRelationshipType || ""),
            name: String(element.presentation.name || element.presentation.layoutName || element.presentation.masterName || ""),
            layoutName: String(element.presentation.layoutName || ""),
            masterName: String(element.presentation.masterName || "")
          }
        : null;
      const image = element.image && typeof element.image === "object"
        ? {
            relationshipId: String(element.image.relationshipId || ""),
            target: String(element.image.target || ""),
            targetMode: String(element.image.targetMode || ""),
            type: String(element.image.type || ""),
            sourcePart: String(element.image.sourcePart || ""),
            name: String(element.image.name || ""),
            title: String(element.image.title || ""),
            description: String(element.image.description || "")
          }
        : null;
      const chart = element.chart && typeof element.chart === "object"
        ? {
            format: String(element.chart.format || ""),
            relationshipId: String(element.chart.relationshipId || ""),
            target: String(element.chart.target || ""),
            targetMode: String(element.chart.targetMode || ""),
            type: String(element.chart.type || ""),
            sourcePart: String(element.chart.sourcePart || ""),
            chartPart: String(element.chart.chartPart || ""),
            title: String(element.chart.title || ""),
            chartType: String(element.chart.chartType || ""),
            seriesCount: Number(element.chart.seriesCount || 0),
            page: Number(element.chart.page || 0),
            order: Number(element.chart.order || 0),
            sheetName: String(element.chart.sheetName || ""),
            sheetId: String(element.chart.sheetId || ""),
            worksheetPath: String(element.chart.worksheetPath || ""),
            series: Array.isArray(element.chart.series)
              ? element.chart.series.slice(0, 20).map((series) => ({
                  name: String(series.name || ""),
                  categories: Array.isArray(series.categories)
                    ? series.categories.slice(0, 20).map((item) => String(item || "")).filter(Boolean)
                    : [],
                  values: Array.isArray(series.values)
                    ? series.values.slice(0, 20).map((item) => String(item || "")).filter(Boolean)
                    : []
                }))
              : []
          }
        : null;
      const form = element.form && typeof element.form === "object"
        ? {
            strategy: String(element.form.strategy || ""),
            objectNumber: String(element.form.objectNumber || ""),
            name: String(element.form.name || ""),
            alternateName: String(element.form.alternateName || ""),
            fieldType: String(element.form.fieldType || ""),
            rawFieldType: String(element.form.rawFieldType || ""),
            value: String(element.form.value || ""),
            required: Boolean(element.form.required),
            readOnly: Boolean(element.form.readOnly)
          }
        : null;
      const control = element.control && typeof element.control === "object"
        ? {
            kind: String(element.control.kind || ""),
            id: String(element.control.id || ""),
            alias: String(element.control.alias || ""),
            tag: String(element.control.tag || ""),
            controlType: String(element.control.controlType || ""),
            lock: String(element.control.lock || ""),
            sourcePart: String(element.control.sourcePart || "")
          }
        : null;
      const bookmark = element.bookmark && typeof element.bookmark === "object"
        ? {
            kind: String(element.bookmark.kind || ""),
            id: String(element.bookmark.id || ""),
            name: String(element.bookmark.name || ""),
            sourcePart: String(element.bookmark.sourcePart || "")
          }
        : null;
      const headerFooter = element.headerFooter && typeof element.headerFooter === "object"
        ? {
            kind: String(element.headerFooter.kind || ""),
            partName: String(element.headerFooter.partName || ""),
            partIndex: Number(element.headerFooter.partIndex || 0),
            label: String(element.headerFooter.label || "")
          }
        : null;
      const definedName = element.definedName && typeof element.definedName === "object"
        ? {
            kind: String(element.definedName.kind || ""),
            name: String(element.definedName.name || ""),
            displayName: String(element.definedName.displayName || ""),
            builtin: Boolean(element.definedName.builtin),
            builtinType: String(element.definedName.builtinType || ""),
            scope: String(element.definedName.scope || ""),
            localSheetId: String(element.definedName.localSheetId || ""),
            hidden: Boolean(element.definedName.hidden),
            sheetName: String(element.definedName.sheetName || ""),
            sheetId: String(element.definedName.sheetId || ""),
            worksheetPath: String(element.definedName.worksheetPath || ""),
            ref: String(element.definedName.ref || ""),
            formula: String(element.definedName.formula || ""),
            sourcePart: String(element.definedName.sourcePart || ""),
            ranges: Array.isArray(element.definedName.ranges)
              ? element.definedName.ranges.slice(0, 20).map((range) => ({
                  sheetName: String(range.sheetName || ""),
                  ref: String(range.ref || ""),
                  startRef: String(range.startRef || ""),
                  endRef: String(range.endRef || ""),
                  startColumn: String(range.startColumn || ""),
                  endColumn: String(range.endColumn || ""),
                  startRow: Number(range.startRow || 0),
                  endRow: Number(range.endRow || 0),
                  rowSpan: Number(range.rowSpan || 0),
                  columnSpan: Number(range.columnSpan || 0),
                  cellRefs: Array.isArray(range.cellRefs)
                    ? range.cellRefs.slice(0, 200).map((ref) => String(ref || "")).filter(Boolean)
                    : []
                }))
              : []
          }
        : null;
      const codeBlock = element.codeBlock && typeof element.codeBlock === "object"
        ? {
            kind: String(element.codeBlock.kind || ""),
            fence: String(element.codeBlock.fence || ""),
            language: String(element.codeBlock.language || ""),
            lineStart: Number(element.codeBlock.lineStart || 0),
            lineEnd: Number(element.codeBlock.lineEnd || 0),
            lineCount: Number(element.codeBlock.lineCount || 0)
          }
        : null;
      const quote = element.quote && typeof element.quote === "object"
        ? {
            kind: String(element.quote.kind || ""),
            depth: Number(element.quote.depth || 0),
            lineStart: Number(element.quote.lineStart || 0),
            lineEnd: Number(element.quote.lineEnd || 0)
          }
        : null;
      const merge = element.merge && typeof element.merge === "object"
        ? {
            ref: String(element.merge.ref || ""),
            masterRef: String(element.merge.masterRef || element.merge.startRef || ""),
            startRef: String(element.merge.startRef || ""),
            endRef: String(element.merge.endRef || ""),
            startColumn: String(element.merge.startColumn || ""),
            endColumn: String(element.merge.endColumn || ""),
            startRow: Number(element.merge.startRow || 0),
            endRow: Number(element.merge.endRow || 0),
            rowSpan: Number(element.merge.rowSpan || 0),
            columnSpan: Number(element.merge.columnSpan || 0),
            cellRefs: Array.isArray(element.merge.cellRefs)
              ? element.merge.cellRefs.slice(0, 200).map((ref) => String(ref || "")).filter(Boolean)
              : [],
            anchorValue: String(element.merge.anchorValue || "")
          }
        : null;
      const frontmatter = element.frontmatter && typeof element.frontmatter === "object"
        ? {
            format: String(element.frontmatter.format || ""),
            key: String(element.frontmatter.key || ""),
            value: Array.isArray(element.frontmatter.value)
              ? element.frontmatter.value.map((item) => String(item || "")).filter(Boolean)
              : element.frontmatter.value,
            valueText: String(element.frontmatter.valueText || ""),
            valueType: String(element.frontmatter.valueType || ""),
            raw: String(element.frontmatter.raw || "")
          }
        : null;
      const cells = Array.isArray(element.cells)
        ? element.cells.slice(0, 200).map((cell) => ({
            ref: String(cell.ref || ""),
            column: String(cell.column || ""),
            row: Number(cell.row || 0),
            header: String(cell.header || ""),
            value: String(cell.value || ""),
            rawValue: String(cell.rawValue || ""),
            dateIso: String(cell.dateIso || ""),
            dateSerial: String(cell.dateSerial || ""),
            style: cell.style
              ? {
                  styleIndex: Number(cell.style.styleIndex || 0),
                  numFmtId: Number(cell.style.numFmtId || 0),
                  formatCode: String(cell.style.formatCode || ""),
                  isDate: Boolean(cell.style.isDate)
                }
              : null,
            formula: String(cell.formula || ""),
            formulaType: String(cell.formulaType || ""),
            formulaRef: String(cell.formulaRef || ""),
            sharedIndex: String(cell.sharedIndex || ""),
            hyperlink: cell.hyperlink
              ? {
                  target: String(cell.hyperlink.target || ""),
                  location: String(cell.hyperlink.location || ""),
                  display: String(cell.hyperlink.display || ""),
                  tooltip: String(cell.hyperlink.tooltip || ""),
                  relationshipId: String(cell.hyperlink.relationshipId || ""),
                  targetMode: String(cell.hyperlink.targetMode || "")
                }
              : null,
            merge: cell.merge
              ? {
                  ref: String(cell.merge.ref || ""),
                  masterRef: String(cell.merge.masterRef || ""),
                  startRef: String(cell.merge.startRef || ""),
                  endRef: String(cell.merge.endRef || ""),
                  rowSpan: Number(cell.merge.rowSpan || 0),
                  columnSpan: Number(cell.merge.columnSpan || 0)
                }
              : null,
            comment: cell.comment
              ? {
                  ref: String(cell.comment.ref || cell.ref || ""),
                  author: String(cell.comment.author || ""),
                  authorId: Number(cell.comment.authorId || 0),
                  text: String(cell.comment.text || ""),
                  relationshipId: String(cell.comment.relationshipId || ""),
                  target: String(cell.comment.target || ""),
                  sourcePart: String(cell.comment.sourcePart || ""),
                  type: String(cell.comment.type || "")
                }
              : null
          }))
        : [];
      const transcript = element.transcript && typeof element.transcript === "object"
        ? {
            kind: String(element.transcript.kind || ""),
            cueId: String(element.transcript.cueId || ""),
            speaker: String(element.transcript.speaker || ""),
            start: String(element.transcript.start || ""),
            end: String(element.transcript.end || ""),
            startSeconds: Number(element.transcript.startSeconds || 0),
            endSeconds: Number(element.transcript.endSeconds || 0)
          }
        : null;
      const xbrlFact = element.xbrlFact && typeof element.xbrlFact === "object"
        ? {
            name: String(element.xbrlFact.name || ""),
            localName: String(element.xbrlFact.localName || ""),
            contextRef: String(element.xbrlFact.contextRef || ""),
            unitRef: String(element.xbrlFact.unitRef || ""),
            decimals: String(element.xbrlFact.decimals || ""),
            value: String(element.xbrlFact.value || ""),
            periodStart: String(element.xbrlFact.periodStart || ""),
            periodEnd: String(element.xbrlFact.periodEnd || ""),
            instant: String(element.xbrlFact.instant || "")
          }
        : null;
      return {
        elementId: element.elementId || stableId("element", document.sourceId, String(index), element.type || "text", element.text || ""),
        index,
        type: String(element.type || "text"),
        text: String(element.text || "").trim(),
        level: Number(element.level || 0),
        line: Number(element.line || 0),
        href: String(element.href || ""),
        name: String(element.name || ""),
        page,
        bbox,
        layout,
        table,
        annotation,
        style,
        shape,
        presentation,
        image,
        chart,
        form,
        control,
        bookmark,
        headerFooter,
        definedName,
        codeBlock,
        quote,
        merge,
        frontmatter,
        cells,
        transcript,
        xbrlFact
      };
    })
    .filter((element) => element.text);
}

function isHeadingStructureElement(element = {}) {
  return ["title", "heading", "task-heading"].includes(element.type);
}

function isIsolatedStructureElement(element = {}) {
  return ["table-header", "table-row", "merged-cell", "cell-comment", "defined-name", "code", "code-boundary", "formula", "image", "chart", "pdf-form-field", "content-control", "bookmark", "header", "footer", "slide-layout", "slide-master", "visio-connector", "frontmatter", "comment", "footnote", "endnote", "revision", "speaker-note", "transcript-cue", "speaker-turn", "xbrl-fact"].includes(element.type);
}

function headingLevelForElement(element = {}) {
  if (element.level) {
    return Math.max(1, Math.min(8, Number(element.level)));
  }
  return element.type === "title" ? 1 : 2;
}

function buildStructureWindowRecord(document = {}, index = 0, elements = [], headingPath = [], boundaryReason = "element-sequence") {
  const text = elements.map(structureElementLine).join("\n").trim();
  const first = elements[0] || {};
  const last = elements[elements.length - 1] || first;
  const record = buildWindowRecord(document, index, first.index || 0, (last.index || 0) + 1, text);
  return {
    ...record,
    offsetUnit: "element-index",
    semanticChunkStrategy: "unstructured.by-title-element-windowing.v1",
    boundaryReason,
    headingPath,
    elementRefs: elements.map((element) => ({
      elementId: element.elementId,
      type: element.type,
      index: element.index,
      href: element.href || "",
      line: element.line || null,
      page: element.page || null,
      bbox: element.bbox || null,
      layout: element.layout || null,
      table: element.table || null,
      annotation: element.annotation || null,
      style: element.style || null,
      shape: element.shape || null,
      presentation: element.presentation || null,
      image: element.image || null,
      chart: element.chart || null,
      form: element.form || null,
      control: element.control || null,
      bookmark: element.bookmark || null,
      headerFooter: element.headerFooter || null,
      definedName: element.definedName || null,
      codeBlock: element.codeBlock || null,
      quote: element.quote || null,
      merge: element.merge || null,
      frontmatter: element.frontmatter || null,
      cells: element.cells || [],
      transcript: element.transcript || null,
      xbrlFact: element.xbrlFact || null,
      headingPath
    })),
    elementTypes: uniqueOrdered(elements.map((element) => element.type))
  };
}

function buildElementAwareWindowPlan(document = {}, options = {}) {
  const elements = normalizedStructureElements(document);
  if (!elements.length) {
    return null;
  }
  const { maxCharacters, overlapCharacters } = normalizedWindowOptions(options);
  const windows = [];
  const headingStack = [];
  let current = [];
  let currentCharacters = 0;
  let currentHeadingPath = [];

  const closeCurrent = (reason = "element-boundary") => {
    if (!current.length) {
      return;
    }
    windows.push(buildStructureWindowRecord(document, windows.length, current, currentHeadingPath, reason));
    current = [];
    currentCharacters = 0;
  };

  const addElement = (element) => {
    const line = structureElementLine(element);
    current.push(element);
    currentCharacters += line.length + 1;
  };

  for (const element of elements) {
    const line = structureElementLine(element);
    if (isHeadingStructureElement(element)) {
      closeCurrent("heading-boundary");
      const level = headingLevelForElement(element);
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: element.text });
      currentHeadingPath = headingStack.map((item) => item.text);
      addElement(element);
      continue;
    }

    const isolated = isIsolatedStructureElement(element);
    const currentHasIsolated = current.some(isIsolatedStructureElement);
    const differentIsolatedRun = currentHasIsolated && !current.every((item) => item.type === element.type);
    const wouldOverflow = current.length > 0 && currentCharacters + line.length + 1 > maxCharacters;
    if (current.length && (wouldOverflow || (isolated && !currentHasIsolated) || differentIsolatedRun)) {
      closeCurrent(wouldOverflow ? "size-boundary" : `${element.type}-isolation`);
    }
    currentHeadingPath = headingStack.map((item) => item.text);
    addElement(element);
  }
  closeCurrent("document-end");

  return {
    strategy: "element-aware-by-title-windowing.v1",
    maxCharacters,
    overlapCharacters: 0,
    requestedOverlapCharacters: overlapCharacters,
    windowCount: windows.length,
    truncated: false,
    source: {
      kind: "structure-elements",
      elementCount: elements.length,
      structureFormat: document.structureFormat || "",
      referencePatterns: [
        "unstructured.chunk_by_title",
        "unstructured.table-isolated-pre-chunks",
        "docling.docitem-labels",
        "llama-index.nodes-with-metadata"
      ]
    },
    windows
  };
}

function buildDocumentElementPlan(document = {}, windowPlan = null) {
  const elements = normalizedStructureElements(document);
  if (!elements.length) {
    return null;
  }
  const counts = structureElementTypeCounts(elements);
  return {
    strategy: "document-element-model.v1",
    sourceFormat: document.structureFormat || document.extension || "",
    elementCount: elements.length,
    elementTypes: counts,
    chunkingStrategy: windowPlan?.strategy || "",
    referencePatterns: [
      "unstructured.elements",
      "unstructured.chunk_by_title",
      "docling.docitem-labels",
      "llama-index.nodes-with-metadata"
    ],
    sampleElements: elements.slice(0, 80).map((element) => ({
      elementId: element.elementId,
      index: element.index,
      type: element.type,
      text: element.text.slice(0, 500),
      line: element.line || null,
      level: element.level || null,
      href: element.href || "",
      page: element.page || null,
      bbox: element.bbox || null,
      layout: element.layout || null,
      table: element.table || null,
      annotation: element.annotation || null,
      style: element.style || null,
      shape: element.shape || null,
      presentation: element.presentation || null,
      image: element.image || null,
      chart: element.chart || null,
      form: element.form || null,
      control: element.control || null,
      bookmark: element.bookmark || null,
      headerFooter: element.headerFooter || null,
      definedName: element.definedName || null,
      codeBlock: element.codeBlock || null,
      quote: element.quote || null,
      merge: element.merge || null,
      frontmatter: element.frontmatter || null,
      cells: element.cells || [],
      transcript: element.transcript || null,
      xbrlFact: element.xbrlFact || null
    }))
  };
}

function professionalFormatAdapter(formatId = "") {
  return PROFESSIONAL_FORMAT_ADAPTERS[String(formatId || "")] || null;
}

function professionalFormatMatrix(formatIds = PROFESSIONAL_FORMAT_ORDER) {
  return formatIds
    .map((formatId) => {
      const adapter = professionalFormatAdapter(formatId);
      if (!adapter) {
        return null;
      }
      return {
        routeId: formatId,
        label: adapter.label,
        professionalFamily: adapter.professionalFamily,
        parserProfile: adapter.parserProfile,
        structureUnits: adapter.structureUnits,
        parserStages: adapter.parserStages,
        conversionTargets: adapter.conversionTargets,
        conversionAdapters: adapter.conversionAdapters,
        qualityGates: adapter.qualityGates,
        riskControls: adapter.riskControls,
        knownLosses: adapter.knownLosses
      };
    })
    .filter(Boolean);
}

function professionalDocumentProfile(route = {}, document = {}, elementPlan = null) {
  const formatId = route?.formatId || route?.id || "unknown";
  const sourceFormat = elementPlan?.sourceFormat || document.structureFormat || document.extension || formatId;
  const adapter = professionalFormatAdapter(formatId);
  const base = {
    strategy: "office-document-professional-adaptation.v1",
    sourceFormat,
    routeId: formatId,
    humanReadableModes: ["portable-markdown", "portable-docx"],
    agentReadableModes: ["agent-message-json", "result-json", "evidence-pack-json"],
    preserves: ["sourceId", "routePlan", "parserTrace", "elementRefs", "windowIds", "contentHash"],
    knownLosses: []
  };
  if (adapter) {
    return {
      ...base,
      professionalFamily: adapter.professionalFamily,
      parserProfile: adapter.parserProfile,
      structureUnits: adapter.structureUnits,
      parserStages: adapter.parserStages,
      preserves: uniqueOrdered([...base.preserves, ...adapter.preserves]),
      conversionTargets: adapter.conversionTargets,
      conversionAdapters: adapter.conversionAdapters,
      qualityGates: adapter.qualityGates,
      riskControls: adapter.riskControls,
      knownLosses: adapter.knownLosses
    };
  }
  return {
    ...base,
    parserProfile: `${formatId}-route`,
    professionalFamily: "generic",
    structureUnits: ["document"],
    parserStages: [route?.preferredParser || `${formatId}.parse`],
    conversionTargets: ["portable-markdown", "agent-json", "evidence-pack"],
    conversionAdapters: [
      {
        target: "portable-markdown",
        targetFormat: "markdown",
        adapter: "generic-text-to-markdown.v1",
        mode: "human",
        stages: ["text-normalization"]
      },
      {
        target: "agent-message-json",
        targetFormat: "agent-json",
        adapter: "generic-text-to-agent-message.v1",
        mode: "agent",
        stages: ["window-refs"]
      }
    ],
    qualityGates: ["empty-corpus-blocked"],
    riskControls: ["generic-text-fallback"]
  };
}

function maxTraceMetric(document = {}, names = []) {
  const traces = Array.isArray(document.parserTrace) ? document.parserTrace : [];
  let maxValue = 0;
  for (const trace of traces) {
    for (const name of names) {
      const value = Number(trace?.[name] || 0);
      if (Number.isFinite(value) && value > maxValue) {
        maxValue = value;
      }
    }
  }
  return maxValue;
}

function hasTraceStage(document = {}, stage = "", status = "") {
  const traces = Array.isArray(document.parserTrace) ? document.parserTrace : [];
  return traces.some((trace) => (
    trace?.stage === stage &&
    (!status || trace?.status === status)
  ));
}

function professionalGateRecord(gate = "", status = "not_applicable", details = {}) {
  const severity = status === "failed"
    ? "error"
    : status === "warning"
      ? "warning"
      : "info";
  return {
    gate,
    status,
    severity,
    scope: details.scope || "source-document",
    validationMode: details.validationMode || "evidence-derived",
    observed: details.observed || {},
    required: details.required || {},
    message: details.message || ""
  };
}

function buildProfessionalQualityGateResults({ document = {}, profile = {}, evidence = {}, conversionAdapters = [] } = {}) {
  const routeId = document.route?.formatId || document.route?.id || profile.routeId || "unknown";
  const gates = Array.isArray(profile.qualityGates) ? profile.qualityGates : [];
  const hasDistillableCorpus = Boolean(
    document.quality?.distillable ||
    Number(document.quality?.textCharacters || 0) > 0 ||
    Number(evidence.elementCount || 0) > 0 ||
    Number(evidence.windowCount || 0) > 0
  );
  const hasDocxAdapter = conversionAdapters.some((adapter) => adapter.targetFormat === "docx");
  const resultForGate = (gate) => {
    if (gate === "empty-corpus-blocked") {
      return professionalGateRecord(gate, hasDistillableCorpus ? "passed" : "failed", {
        observed: {
          textCharacters: Number(document.quality?.textCharacters || 0),
          elementCount: evidence.elementCount,
          windowCount: evidence.windowCount
        },
        required: { distillableCorpus: true },
        message: hasDistillableCorpus ? "Distillable corpus is present." : "No distillable corpus was produced for this source."
      });
    }
    if (gate === "docx-openxml-package-valid") {
      return professionalGateRecord(gate, hasDocxAdapter ? "passed" : "failed", {
        scope: "output-artifact",
        validationMode: "adapter-contract-and-artifact-self-check",
        observed: {
          hasDocxAdapter,
          adapter: conversionAdapters.find((adapter) => adapter.targetFormat === "docx")?.adapter || ""
        },
        required: { targetFormat: "docx", package: "openxml" },
        message: hasDocxAdapter
          ? "DOCX conversion adapter is present; generated portable DOCX is self-checked in outputArtifactValidation."
          : "No DOCX conversion adapter is registered for this source format."
      });
    }
    if (gate === "page-order-preserved") {
      const pageSignals = maxTraceMetric(document, ["pages", "pageCount"]) || evidence.geometryElementCount;
      return professionalGateRecord(gate, routeId === "pdf" && pageSignals > 0 ? "passed" : routeId === "pdf" ? "warning" : "not_applicable", {
        observed: { pageSignals, geometryElementCount: evidence.geometryElementCount },
        required: { routeId: "pdf", orderedPages: true },
        message: pageSignals > 0 ? "PDF page/order signals are preserved." : "PDF page/order signals were not observed."
      });
    }
    if (gate === "bbox-metadata-present-when-available") {
      const layoutSignals = maxTraceMetric(document, ["layoutBlocks", "geometries", "geometryCount"]);
      const status = routeId !== "pdf"
        ? "not_applicable"
        : evidence.geometryElementCount > 0
          ? "passed"
          : layoutSignals > 0
            ? "failed"
            : "warning";
      return professionalGateRecord(gate, status, {
        observed: { layoutSignals, geometryElementCount: evidence.geometryElementCount },
        required: { bboxWhenLayoutAvailable: true },
        message: evidence.geometryElementCount > 0
          ? "Layout geometry is available on element references."
          : "No bbox metadata was attached to the PDF element sample."
      });
    }
    if (gate === "pdf-link-refs-preserved") {
      const linkSignals = maxTraceMetric(document, ["links", "hyperlinks", "linkCount"]);
      const status = routeId !== "pdf"
        ? "not_applicable"
        : linkSignals > 0
          ? evidence.linkElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { linkSignals, linkElementCount: evidence.linkElementCount },
        required: { linksWhenPresent: true },
        message: status === "passed" ? "PDF URI annotations are preserved as link element references." : "No PDF URI annotations were required or observed."
      });
    }
    if (gate === "pdf-outline-refs-preserved") {
      const outlineSignals = maxTraceMetric(document, ["outlines", "outlineCount"]);
      const status = routeId !== "pdf"
        ? "not_applicable"
        : outlineSignals > 0
          ? evidence.pdfOutlineRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { outlineSignals, pdfOutlineRefCount: evidence.pdfOutlineRefCount },
        required: { outlineRefsWhenBookmarksExist: true },
        message: status === "passed" ? "PDF outline/bookmark entries are preserved as element references." : "No PDF outline/bookmark entries were required or observed."
      });
    }
    if (gate === "pdf-form-fields-preserved") {
      const formSignals = maxTraceMetric(document, ["formFields", "fields"]);
      const status = routeId !== "pdf"
        ? "not_applicable"
        : formSignals > 0
          ? evidence.pdfFormFieldRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { formSignals, pdfFormFieldRefCount: evidence.pdfFormFieldRefCount },
        required: { formFieldRefsWhenAcroFormExists: true },
        message: status === "passed" ? "PDF AcroForm/widget fields are preserved as structured element references." : "No PDF form fields were required or observed."
      });
    }
    if (gate === "word-table-cell-refs-preserved") {
      const tableCells = maxTraceMetric(document, ["tableCells", "cells"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : tableCells > 0
          ? evidence.cellRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { tableCells, cellRefCount: evidence.cellRefCount },
        required: { cellRefsWhenTablesExist: true },
        message: status === "passed" ? "Word table cell references are present." : "No Word table cell references were required or observed."
      });
    }
    if (gate === "word-header-footer-refs-preserved") {
      const headerFooterRefCount = Number(evidence.headerFooterRefCount || 0);
      const headerFooterSignals = maxTraceMetric(document, ["headerFooters", "headerFooterRefs"]) || headerFooterRefCount;
      const status = routeId !== "word"
        ? "not_applicable"
        : headerFooterSignals > 0
          ? headerFooterRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { headerFooterSignals, headerFooterRefCount },
        required: { headerFooterRefsWhenPresent: true },
        message: status === "passed" ? "Word header and footer parts are preserved as structured element references." : "No Word header or footer references were required or observed."
      });
    }
    if (gate === "word-paragraph-style-refs-preserved") {
      const styleSignals = maxTraceMetric(document, ["styles", "styleRefs", "headingCount", "headings"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : styleSignals > 0
          ? evidence.styleRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { styleSignals, styleRefCount: evidence.styleRefCount },
        required: { paragraphStylesWhenPresent: true },
        message: status === "passed" ? "Word paragraph style references are preserved." : "No Word paragraph style references were required or observed."
      });
    }
    if (gate === "word-list-refs-preserved") {
      const listSignals = maxTraceMetric(document, ["numberingRefs", "listItems"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : listSignals > 0
          ? evidence.numberingRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { listSignals, numberingRefCount: evidence.numberingRefCount },
        required: { numberingRefsWhenListItemsExist: true },
        message: status === "passed" ? "Word numbered/bulleted list references are preserved." : "No Word list references were required or observed."
      });
    }
    if (gate === "word-content-control-refs-preserved") {
      const contentControlRefCount = Number(evidence.contentControlRefCount || 0);
      const controlSignals = maxTraceMetric(document, ["contentControls", "contentControlCount"]) || contentControlRefCount;
      const status = routeId !== "word"
        ? "not_applicable"
        : controlSignals > 0
          ? contentControlRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { controlSignals, contentControlRefCount },
        required: { contentControlRefsWhenPresent: true },
        message: status === "passed" ? "Word content controls are preserved as structured element references." : "No Word content controls were required or observed."
      });
    }
    if (gate === "word-bookmark-refs-preserved") {
      const bookmarkRefCount = Number(evidence.bookmarkRefCount || 0);
      const bookmarkSignals = maxTraceMetric(document, ["bookmarks", "bookmarkCount"]) || bookmarkRefCount;
      const status = routeId !== "word"
        ? "not_applicable"
        : bookmarkSignals > 0
          ? bookmarkRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { bookmarkSignals, bookmarkRefCount },
        required: { bookmarkRefsWhenPresent: true },
        message: status === "passed" ? "Word bookmarks are preserved as structured element references." : "No Word bookmarks were required or observed."
      });
    }
    if (gate === "word-annotation-refs-preserved") {
      const annotations = maxTraceMetric(document, ["annotations", "comments", "footnotes", "endnotes"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : annotations > 0
          ? evidence.annotationElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { annotations, annotationElementCount: evidence.annotationElementCount },
        required: { annotationRefsWhenAnnotationsExist: true },
        message: status === "passed" ? "Word comments/footnotes/endnotes are preserved as element references." : "No Word annotations were required or observed."
      });
    }
    if (gate === "word-revision-refs-preserved") {
      const revisions = maxTraceMetric(document, ["revisions", "revisionCount", "insertedRevisions", "deletedRevisions"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : revisions > 0
          ? evidence.revisionRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { revisions, revisionRefCount: evidence.revisionRefCount },
        required: { revisionRefsWhenTrackedChangesExist: true },
        message: status === "passed" ? "Word tracked changes are preserved as revision element references." : "No Word tracked changes were required or observed."
      });
    }
    if (gate === "word-link-refs-preserved") {
      const linkSignals = maxTraceMetric(document, ["links", "hyperlinks", "hyperlinkCount"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : linkSignals > 0
          ? evidence.linkElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { linkSignals, linkElementCount: evidence.linkElementCount },
        required: { linksWhenPresent: true },
        message: status === "passed" ? "Word hyperlinks are preserved as element references." : "No Word hyperlinks were required or observed."
      });
    }
    if (gate === "word-image-refs-preserved") {
      const imageSignals = maxTraceMetric(document, ["images", "imageCount"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : imageSignals > 0
          ? evidence.imageRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { imageSignals, imageRefCount: evidence.imageRefCount },
        required: { imageRefsWhenPresent: true },
        message: status === "passed" ? "Word image relationship targets are preserved as element references." : "No Word images were required or observed."
      });
    }
    if (gate === "word-chart-refs-preserved") {
      const chartSignals = maxTraceMetric(document, ["charts", "chartCount"]);
      const status = routeId !== "word"
        ? "not_applicable"
        : chartSignals > 0
          ? evidence.chartRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { chartSignals, chartRefCount: evidence.chartRefCount, chartSeriesRefCount: evidence.chartSeriesRefCount },
        required: { chartRefsWhenPresent: true },
        message: status === "passed" ? "Word chart relationship targets and series metadata are preserved as element references." : "No Word chart references were required or observed."
      });
    }
    if (gate === "slide-order-preserved") {
      const slideCount = maxTraceMetric(document, ["slides", "slideCount"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : slideCount > 0 || evidence.elementCount > 0
          ? "passed"
          : "warning";
      return professionalGateRecord(gate, status, {
        observed: { slideCount, elementCount: evidence.elementCount },
        required: { orderedSlides: true },
        message: status === "passed" ? "Slide sequence is represented in element refs." : "Slide sequence was not observed."
      });
    }
    if (gate === "presentation-layout-master-refs-preserved") {
      const layoutSignals = maxTraceMetric(document, ["layoutRefs", "slideLayouts"]);
      const masterSignals = maxTraceMetric(document, ["masterRefs", "slideMasters"]);
      const presentationLayoutRefCount = Number(evidence.presentationLayoutRefCount || 0);
      const presentationMasterRefCount = Number(evidence.presentationMasterRefCount || 0);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : layoutSignals > 0 || masterSignals > 0
          ? presentationLayoutRefCount > 0 && (masterSignals === 0 || presentationMasterRefCount > 0) ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { layoutSignals, masterSignals, presentationLayoutRefCount, presentationMasterRefCount },
        required: { layoutRefsWhenSlideLayoutExists: true, masterRefsWhenSlideMasterExists: true },
        message: status === "passed" ? "PowerPoint slide layout and master inheritance are preserved as element references." : "No PowerPoint layout/master references were required or observed."
      });
    }
    if (gate === "shape-layout-refs-present") {
      const geometrySignals = maxTraceMetric(document, ["geometries", "shapeGeometries", "tableGeometries"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : geometrySignals > 0
          ? evidence.geometryElementCount > 0 ? "passed" : "failed"
          : "warning";
      return professionalGateRecord(gate, status, {
        observed: { geometrySignals, geometryElementCount: evidence.geometryElementCount },
        required: { shapeLayoutRefs: true },
        message: status === "passed" ? "PowerPoint shape/table geometry is attached to element refs." : "PowerPoint layout geometry was not attached."
      });
    }
    if (gate === "presentation-placeholder-refs-preserved") {
      const placeholderSignals = maxTraceMetric(document, ["placeholders", "placeholderCount"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : placeholderSignals > 0
          ? evidence.placeholderRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { placeholderSignals, placeholderRefCount: evidence.placeholderRefCount },
        required: { placeholderRefsWhenPresent: true },
        message: status === "passed" ? "PowerPoint placeholder references are preserved on element refs." : "No PowerPoint placeholder references were required or observed."
      });
    }
    if (gate === "presentation-table-cell-refs-preserved") {
      const tableCells = maxTraceMetric(document, ["tableCells", "cells"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : tableCells > 0
          ? evidence.cellRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { tableCells, cellRefCount: evidence.cellRefCount },
        required: { cellRefsWhenTablesExist: true },
        message: status === "passed" ? "PowerPoint table cell references are preserved." : "No PowerPoint table cell references were required or observed."
      });
    }
    if (gate === "presentation-link-refs-preserved") {
      const linkSignals = maxTraceMetric(document, ["links", "hyperlinks", "hyperlinkCount"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : linkSignals > 0
          ? evidence.linkElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { linkSignals, linkElementCount: evidence.linkElementCount },
        required: { linksWhenPresent: true },
        message: status === "passed" ? "PowerPoint hyperlinks are preserved as element references." : "No PowerPoint hyperlinks were required or observed."
      });
    }
    if (gate === "presentation-image-refs-preserved") {
      const imageSignals = maxTraceMetric(document, ["images", "imageCount"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : imageSignals > 0
          ? evidence.imageRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { imageSignals, imageRefCount: evidence.imageRefCount },
        required: { imageRefsWhenPresent: true },
        message: status === "passed" ? "PowerPoint image relationship targets are preserved as element references." : "No PowerPoint images were required or observed."
      });
    }
    if (gate === "presentation-chart-refs-preserved") {
      const chartSignals = maxTraceMetric(document, ["charts", "chartCount"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : chartSignals > 0
          ? evidence.chartRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { chartSignals, chartRefCount: evidence.chartRefCount, chartSeriesRefCount: evidence.chartSeriesRefCount },
        required: { chartRefsWhenPresent: true },
        message: status === "passed" ? "PowerPoint chart relationship targets and series metadata are preserved as element references." : "No PowerPoint chart references were required or observed."
      });
    }
    if (gate === "presentation-speaker-notes-preserved") {
      const noteSignals = maxTraceMetric(document, ["speakerNotes", "notes"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : noteSignals > 0
          ? evidence.speakerNoteElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { noteSignals, speakerNoteElementCount: evidence.speakerNoteElementCount },
        required: { speakerNotesWhenPresent: true },
        message: status === "passed" ? "PowerPoint speaker notes are preserved as element references." : "No PowerPoint speaker notes were required or observed."
      });
    }
    if (gate === "presentation-comment-refs-preserved") {
      const commentSignals = maxTraceMetric(document, ["comments", "commentCount"]);
      const status = routeId !== "presentation"
        ? "not_applicable"
        : commentSignals > 0
          ? evidence.presentationCommentRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { commentSignals, presentationCommentRefCount: evidence.presentationCommentRefCount },
        required: { commentRefsWhenPresent: true },
        message: status === "passed" ? "PowerPoint comments are preserved as element references." : "No PowerPoint comments were required or observed."
      });
    }
    if (gate === "visio-page-order-preserved") {
      const pageSignals = maxTraceMetric(document, ["pages", "pageCount", "visioPartCount"]);
      const status = routeId !== "visio"
        ? "not_applicable"
        : pageSignals > 0 || evidence.elementCount > 0
          ? "passed"
          : "warning";
      return professionalGateRecord(gate, status, {
        observed: { pageSignals, elementCount: evidence.elementCount },
        required: { orderedPages: true },
        message: status === "passed" ? "Visio page order is represented in element refs." : "Visio page order was not observed."
      });
    }
    if (gate === "visio-shape-refs-preserved") {
      const shapeSignals = maxTraceMetric(document, ["shapes", "shapeCount", "textShapes", "textShapeCount"]);
      const status = routeId !== "visio"
        ? "not_applicable"
        : shapeSignals > 0
          ? evidence.visioShapeRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { shapeSignals, visioShapeRefCount: evidence.visioShapeRefCount },
        required: { shapeRefsWhenShapesExist: true },
        message: status === "passed" ? "Visio shapes are preserved as structured element references." : "No Visio shape references were required or observed."
      });
    }
    if (gate === "visio-shape-layout-refs-present") {
      const geometrySignals = maxTraceMetric(document, ["geometries", "geometryCount"]);
      const status = routeId !== "visio"
        ? "not_applicable"
        : geometrySignals > 0
          ? evidence.geometryElementCount > 0 ? "passed" : "failed"
          : "warning";
      return professionalGateRecord(gate, status, {
        observed: { geometrySignals, geometryElementCount: evidence.geometryElementCount },
        required: { shapeLayoutRefs: true },
        message: status === "passed" ? "Visio shape geometry is attached to element refs." : "Visio shape geometry was not attached."
      });
    }
    if (gate === "visio-connector-refs-preserved") {
      const connectorSignals = maxTraceMetric(document, ["connectors", "connectorCount"]);
      const status = routeId !== "visio"
        ? "not_applicable"
        : connectorSignals > 0
          ? evidence.visioConnectorRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { connectorSignals, visioConnectorRefCount: evidence.visioConnectorRefCount },
        required: { connectorRefsWhenConnectorsExist: true },
        message: status === "passed" ? "Visio connectors are preserved as structured element references." : "No Visio connectors were required or observed."
      });
    }
    if (gate === "sheet-row-cell-refs-preserved") {
      const cellSignals = maxTraceMetric(document, ["cells", "cellCount"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : evidence.cellRefCount > 0
          ? "passed"
          : cellSignals > 0
            ? "failed"
            : "warning";
      return professionalGateRecord(gate, status, {
        observed: { cellSignals, cellRefCount: evidence.cellRefCount },
        required: { sheetRowCellRefs: true },
        message: status === "passed" ? "Spreadsheet sheet/row/cell references are preserved." : "Spreadsheet cell references were not observed."
      });
    }
    if (gate === "spreadsheet-workbook-sheet-refs-preserved") {
      const workbookSheetSignals = maxTraceMetric(document, ["workbookSheets"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : workbookSheetSignals > 0
          ? evidence.sheetRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { workbookSheetSignals, sheetRefCount: evidence.sheetRefCount },
        required: { workbookSheetRefsWhenWorkbookMetadataExists: true },
        message: status === "passed" ? "Spreadsheet workbook sheet references are preserved." : "No workbook sheet references were required or observed."
      });
    }
    if (gate === "spreadsheet-defined-name-refs-preserved") {
      const definedNameRefCount = Number(evidence.definedNameRefCount || 0);
      const definedNameSignals = maxTraceMetric(document, ["definedNames", "namedRanges", "printAreas"]) || definedNameRefCount;
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : definedNameSignals > 0
          ? definedNameRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: {
          definedNameSignals,
          definedNameRefCount,
          namedRangeRefCount: evidence.namedRangeRefCount,
          printAreaRefCount: evidence.printAreaRefCount
        },
        required: { definedNameRefsWhenWorkbookDefinesNames: true },
        message: status === "passed" ? "Spreadsheet defined names, named ranges, and print areas are preserved as element references." : "No spreadsheet defined names were required or observed."
      });
    }
    if (gate === "spreadsheet-merged-cell-refs-preserved") {
      const mergedCellSignals = maxTraceMetric(document, ["mergedCells", "mergedCellCount"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : mergedCellSignals > 0
          ? evidence.mergeRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { mergedCellSignals, mergeRefCount: evidence.mergeRefCount },
        required: { mergeRefsWhenMergedCellsExist: true },
        message: status === "passed" ? "Spreadsheet merged-cell ranges are preserved as element references." : "No spreadsheet merged-cell ranges were required or observed."
      });
    }
    if (gate === "spreadsheet-comment-refs-preserved") {
      const commentSignals = maxTraceMetric(document, ["comments", "commentCount"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : commentSignals > 0
          ? evidence.spreadsheetCommentRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { commentSignals, spreadsheetCommentRefCount: evidence.spreadsheetCommentRefCount },
        required: { commentRefsWhenCellCommentsExist: true },
        message: status === "passed" ? "Spreadsheet cell comments are preserved as element references." : "No spreadsheet cell comments were required or observed."
      });
    }
    if (gate === "formula-text-preserved") {
      const formulaSignals = maxTraceMetric(document, ["formulas", "formulaCount"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : formulaSignals > 0
          ? evidence.formulaRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { formulaSignals, formulaRefCount: evidence.formulaRefCount },
        required: { formulasWhenPresent: true },
        message: status === "passed" ? "Spreadsheet formula text is preserved." : "No spreadsheet formulas were required or observed."
      });
    }
    if (gate === "spreadsheet-date-serials-normalized") {
      const dateSignals = maxTraceMetric(document, ["dateCells"]);
      const styleSignals = maxTraceMetric(document, ["dateStyles"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : dateSignals > 0
          ? evidence.dateCellRefCount > 0 ? "passed" : "failed"
          : styleSignals > 0
            ? "warning"
            : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { dateSignals, styleSignals, dateCellRefCount: evidence.dateCellRefCount },
        required: { dateSerialRefsWhenDateCellsExist: true },
        message: status === "passed" ? "Spreadsheet date-formatted serial values are normalized to ISO date refs." : "No date-formatted spreadsheet serial values were required or observed."
      });
    }
    if (gate === "spreadsheet-hyperlink-refs-preserved") {
      const hyperlinkSignals = maxTraceMetric(document, ["hyperlinks", "hyperlinkCount"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : hyperlinkSignals > 0
          ? evidence.hyperlinkRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { hyperlinkSignals, hyperlinkRefCount: evidence.hyperlinkRefCount },
        required: { hyperlinksWhenPresent: true },
        message: status === "passed" ? "Spreadsheet hyperlinks are preserved as cell references." : "No spreadsheet hyperlinks were required or observed."
      });
    }
    if (gate === "spreadsheet-chart-refs-preserved") {
      const chartSignals = maxTraceMetric(document, ["charts", "chartCount"]);
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : chartSignals > 0
          ? evidence.chartRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { chartSignals, chartRefCount: evidence.chartRefCount, chartSeriesRefCount: evidence.chartSeriesRefCount },
        required: { chartRefsWhenPresent: true },
        message: status === "passed" ? "Spreadsheet chart drawing relationships and series metadata are preserved as element references." : "No spreadsheet chart references were required or observed."
      });
    }
    if (gate === "table-time-index-when-date-columns-exist") {
      const timeIndexed = hasTraceStage(document, "table.time-index", "completed") || Boolean(document.timeRange?.from || document.timeRange?.to);
      const hasTimeSignals = Array.isArray(document.timeSignals) && document.timeSignals.length > 0;
      const status = routeId !== "spreadsheet"
        ? "not_applicable"
        : timeIndexed
          ? "passed"
          : hasTimeSignals
            ? "failed"
            : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { timeIndexed, timeSignalCount: Array.isArray(document.timeSignals) ? document.timeSignals.length : 0 },
        required: { timeIndexWhenDateColumnsExist: true },
        message: status === "passed" ? "Spreadsheet date columns are reflected in the time index." : "No spreadsheet date-column time index was required or observed."
      });
    }
    if (gate === "heading-tree-preserved") {
      const headings = maxTraceMetric(document, ["headings", "headingCount"]) || Number(document.elementPlan?.elementTypes?.heading || 0);
      const status = routeId !== "markdown"
        ? "not_applicable"
        : headings > 0
          ? "passed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { headings },
        required: { headingTreeWhenHeadingsExist: true },
        message: status === "passed" ? "Markdown heading tree is preserved." : "No Markdown headings were required or observed."
      });
    }
    if (gate === "markdown-frontmatter-refs-preserved") {
      const frontmatterSignals = maxTraceMetric(document, ["frontmatter", "metadata", "fields"]);
      const status = routeId !== "markdown"
        ? "not_applicable"
        : frontmatterSignals > 0
          ? evidence.frontmatterRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { frontmatterSignals, frontmatterRefCount: evidence.frontmatterRefCount },
        required: { frontmatterRefsWhenPresent: true },
        message: status === "passed" ? "Markdown frontmatter fields are preserved as structured element references." : "No Markdown frontmatter fields were required or observed."
      });
    }
    if (gate === "markdown-table-blocks-preserved") {
      const tables = maxTraceMetric(document, ["tables", "tableCount"]);
      const status = routeId !== "markdown"
        ? "not_applicable"
        : tables > 0
          ? evidence.tableElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { tables, tableElementCount: evidence.tableElementCount },
        required: { markdownTablesWhenPresent: true },
        message: status === "passed" ? "Markdown table blocks are preserved." : "No Markdown tables were required or observed."
      });
    }
    if (gate === "markdown-code-blocks-preserved") {
      const codeBlockSignals = maxTraceMetric(document, ["codeBlocks", "codeBlockCount"]);
      const status = routeId !== "markdown"
        ? "not_applicable"
        : codeBlockSignals > 0
          ? evidence.codeBlockRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { codeBlockSignals, codeBlockRefCount: evidence.codeBlockRefCount },
        required: { codeBlockRefsWhenPresent: true },
        message: status === "passed" ? "Markdown code fences are preserved as structured element references." : "No Markdown code fences were required or observed."
      });
    }
    if (gate === "markdown-blockquote-refs-preserved") {
      const blockquoteSignals = maxTraceMetric(document, ["blockquotes", "blockquoteCount"]);
      const status = routeId !== "markdown"
        ? "not_applicable"
        : blockquoteSignals > 0
          ? evidence.blockquoteRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { blockquoteSignals, blockquoteRefCount: evidence.blockquoteRefCount },
        required: { blockquoteRefsWhenPresent: true },
        message: status === "passed" ? "Markdown blockquotes are preserved as structured element references." : "No Markdown blockquotes were required or observed."
      });
    }
    if (gate === "markdown-link-refs-preserved") {
      const linkSignals = maxTraceMetric(document, ["links", "linkCount"]);
      const status = routeId !== "markdown"
        ? "not_applicable"
        : linkSignals > 0
          ? evidence.linkElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { linkSignals, linkElementCount: evidence.linkElementCount },
        required: { linksWhenPresent: true },
        message: status === "passed" ? "Markdown inline links are preserved as element references." : "No Markdown links were required or observed."
      });
    }
    if (gate === "markdown-image-refs-preserved") {
      const imageSignals = maxTraceMetric(document, ["images", "imageCount"]);
      const status = routeId !== "markdown"
        ? "not_applicable"
        : imageSignals > 0
          ? evidence.imageRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { imageSignals, imageRefCount: evidence.imageRefCount },
        required: { imagesWhenPresent: true },
        message: status === "passed" ? "Markdown image references are preserved as element references." : "No Markdown image references were required or observed."
      });
    }
    if (gate === "odf-content-order-preserved") {
      const status = routeId !== "open-document"
        ? "not_applicable"
        : hasTraceStage(document, "open-document.structured", "completed") || evidence.elementCount > 0
          ? "passed"
          : "warning";
      return professionalGateRecord(gate, status, {
        observed: { elementCount: evidence.elementCount, structuredStage: hasTraceStage(document, "open-document.structured", "completed") },
        required: { contentXmlOrder: true },
        message: status === "passed" ? "OpenDocument content order is represented in element refs." : "OpenDocument content order was not observed."
      });
    }
    if (gate === "opendocument-table-cell-refs-preserved") {
      const tableCells = maxTraceMetric(document, ["tableCells", "cells"]);
      const status = routeId !== "open-document"
        ? "not_applicable"
        : tableCells > 0
          ? evidence.cellRefCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { tableCells, cellRefCount: evidence.cellRefCount },
        required: { cellRefsWhenTablesExist: true },
        message: status === "passed" ? "OpenDocument table cell references are preserved." : "No OpenDocument table cell references were required or observed."
      });
    }
    if (gate === "opendocument-link-refs-preserved") {
      const linkSignals = maxTraceMetric(document, ["links", "hyperlinks", "linkCount"]);
      const status = routeId !== "open-document"
        ? "not_applicable"
        : linkSignals > 0
          ? evidence.linkElementCount > 0 ? "passed" : "failed"
          : "not_applicable";
      return professionalGateRecord(gate, status, {
        observed: { linkSignals, linkElementCount: evidence.linkElementCount },
        required: { linksWhenPresent: true },
        message: status === "passed" ? "OpenDocument hyperlinks are preserved as element references." : "No OpenDocument hyperlinks were required or observed."
      });
    }
    return professionalGateRecord(gate, "not_applicable", {
      validationMode: "unmapped-gate",
      message: "No evaluator is registered for this quality gate."
    });
  };
  return gates.map(resultForGate);
}

function qualityGateStatusCounts(results = []) {
  return results.reduce((counts, result) => {
    const status = result.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function conversionRiskLevel(results = []) {
  if (results.some((result) => result.status === "failed")) {
    return "high";
  }
  if (results.some((result) => result.status === "warning")) {
    return "medium";
  }
  return "low";
}

function buildFormatConversionPlan({ runId = "", corpusPlan = null } = {}) {
  const documents = Array.isArray(corpusPlan?.documents) ? corpusPlan.documents : [];
  const plannedDocuments = documents.map((document) => {
    const profile = document.formatConversionProfile || professionalDocumentProfile(document.route, document, document.elementPlan);
    const sampleElements = document.elementPlan?.sampleElements || [];
    const tableElementCount = sampleElements.filter((element) => ["table-header", "table-row"].includes(element.type)).length;
    const cellRefCount = sampleElements.reduce((sum, element) => sum + (Array.isArray(element.cells) ? element.cells.length : 0), 0);
    const formulaRefCount = sampleElements.reduce((sum, element) => (
      sum + (Array.isArray(element.cells) ? element.cells.filter((cell) => cell.formula).length : 0)
    ), 0);
    const hyperlinkRefCount = sampleElements.reduce((sum, element) => (
      sum + (Array.isArray(element.cells) ? element.cells.filter((cell) => cell.hyperlink?.target || cell.hyperlink?.location).length : 0)
    ), 0);
    const mergeRefCount = sampleElements.reduce((sum, element) => (
      sum +
      (element.merge?.ref ? 1 : 0) +
      (Array.isArray(element.cells) ? element.cells.filter((cell) => cell.merge?.ref).length : 0)
    ), 0);
    const spreadsheetCommentRefCount = sampleElements.reduce((sum, element) => (
      sum +
      (element.annotation?.kind === "spreadsheet-comment" ? 1 : 0) +
      (Array.isArray(element.cells) ? element.cells.filter((cell) => cell.comment?.text).length : 0)
    ), 0);
    const dateCellRefCount = sampleElements.reduce((sum, element) => (
      sum + (Array.isArray(element.cells) ? element.cells.filter((cell) => cell.dateIso).length : 0)
    ), 0);
    const sheetRefCount = sampleElements.filter((element) => (
      element.table?.sheetName ||
      element.table?.sheetId ||
      element.table?.relationshipId ||
      element.table?.worksheetPath
    )).length;
    const elementTypes = document.elementPlan?.elementTypes || {};
    const definedNameRefCount = Math.max(
      Number(elementTypes["defined-name"] || 0),
      sampleElements.filter((element) => element.type === "defined-name" && element.definedName).length
    );
    const namedRangeRefCount = sampleElements.filter((element) => (
      element.type === "defined-name" &&
      element.definedName?.builtinType === "named-range"
    )).length;
    const printAreaRefCount = sampleElements.filter((element) => (
      element.type === "defined-name" &&
      element.definedName?.builtinType === "print-area"
    )).length;
    const geometryElementCount = sampleElements.filter((element) => element.bbox || element.page || element.layout).length;
    const annotationElementCount = sampleElements.filter((element) => element.annotation || ["comment", "footnote", "endnote"].includes(element.type)).length;
    const revisionRefCount = Math.max(
      Number(elementTypes.revision || 0),
      sampleElements.filter((element) => element.type === "revision" && element.annotation?.kind === "word-revision").length
    );
    const pdfOutlineRefCount = Math.max(
      Number(elementTypes["pdf-outline"] || 0),
      sampleElements.filter((element) => element.type === "pdf-outline").length
    );
    const pdfFormFieldRefCount = Math.max(
      Number(elementTypes["pdf-form-field"] || 0),
      sampleElements.filter((element) => element.type === "pdf-form-field" && element.form?.name).length
    );
    const frontmatterRefCount = Math.max(
      Number(elementTypes.frontmatter || 0),
      sampleElements.filter((element) => element.type === "frontmatter" && element.frontmatter).length
    );
    const codeBlockRefCount = Math.max(
      Number(elementTypes.code || 0),
      sampleElements.filter((element) => element.type === "code" && element.codeBlock).length
    );
    const blockquoteRefCount = Math.max(
      Number(elementTypes.blockquote || 0),
      sampleElements.filter((element) => element.type === "blockquote" && element.quote).length
    );
    const linkElementCount = sampleElements.filter((element) => element.type === "link" && element.href).length;
    const imageRefCount = sampleElements.filter((element) => element.type === "image" && element.href).length;
    const styleRefCount = sampleElements.filter((element) => element.style?.styleId).length;
    const numberingRefCount = sampleElements.filter((element) => element.style?.numberingId).length;
    const contentControlRefCount = Math.max(
      Number(elementTypes["content-control"] || 0),
      sampleElements.filter((element) => element.type === "content-control" && element.control).length
    );
    const bookmarkRefCount = Math.max(
      Number(elementTypes.bookmark || 0),
      sampleElements.filter((element) => element.type === "bookmark" && element.bookmark).length
    );
    const headerFooterRefCount = Math.max(
      Number(elementTypes.header || 0) + Number(elementTypes.footer || 0),
      sampleElements.filter((element) => element.headerFooter?.partName).length
    );
    const shapeRefCount = sampleElements.filter((element) => element.shape?.id || element.shape?.name).length;
    const visioShapeRefCount = Math.max(
      Number(elementTypes["visio-shape"] || 0),
      sampleElements.filter((element) => element.type === "visio-shape" && (element.shape?.id || element.shape?.name)).length
    );
    const visioConnectorRefCount = Math.max(
      Number(elementTypes["visio-connector"] || 0),
      sampleElements.filter((element) => element.type === "visio-connector" && element.layout?.strategy === "visio-connector-ref.v1").length
    );
    const placeholderRefCount = sampleElements.filter((element) => element.shape?.isPlaceholder || element.shape?.placeholderType).length;
    const presentationLayoutRefCount = Math.max(
      Number(elementTypes["slide-layout"] || 0),
      sampleElements.filter((element) => element.type === "slide-layout" && element.presentation?.layoutPart).length
    );
    const presentationMasterRefCount = Math.max(
      Number(elementTypes["slide-master"] || 0),
      sampleElements.filter((element) => element.type === "slide-master" && element.presentation?.masterPart).length
    );
    const chartRefCount = Math.max(
      Number(elementTypes.chart || 0),
      sampleElements.filter((element) => element.type === "chart" && (element.chart?.chartPart || element.chart?.relationshipId)).length
    );
    const chartSeriesRefCount = sampleElements.reduce((sum, element) => (
      sum + (element.chart?.seriesCount || (Array.isArray(element.chart?.series) ? element.chart.series.length : 0))
    ), 0);
    const speakerNoteElementCount = sampleElements.filter((element) => element.type === "speaker-note").length;
    const presentationCommentRefCount = sampleElements.filter((element) => element.annotation?.kind === "presentation-comment").length;
    const conversionAdapters = Array.isArray(profile.conversionAdapters) ? profile.conversionAdapters : [];
    const evidence = {
      elementCount: Number(document.elementPlan?.elementCount || 0),
      windowCount: Number(document.windowPlan?.windowCount || 0),
      tableElementCount,
      cellRefCount,
      formulaRefCount,
      hyperlinkRefCount,
      mergeRefCount,
      spreadsheetCommentRefCount,
      dateCellRefCount,
      sheetRefCount,
      definedNameRefCount,
      namedRangeRefCount,
      printAreaRefCount,
      geometryElementCount,
      annotationElementCount,
      revisionRefCount,
      pdfOutlineRefCount,
      pdfFormFieldRefCount,
      frontmatterRefCount,
      codeBlockRefCount,
      blockquoteRefCount,
      linkElementCount,
      imageRefCount,
      styleRefCount,
      numberingRefCount,
      contentControlRefCount,
      bookmarkRefCount,
      headerFooterRefCount,
      shapeRefCount,
      visioShapeRefCount,
      visioConnectorRefCount,
      placeholderRefCount,
      presentationLayoutRefCount,
      presentationMasterRefCount,
      chartRefCount,
      chartSeriesRefCount,
      speakerNoteElementCount,
      presentationCommentRefCount
    };
    const qualityGateResults = buildProfessionalQualityGateResults({
      document,
      profile,
      evidence,
      conversionAdapters
    });
    return {
      sourceId: document.sourceId,
      title: document.title,
      fileName: document.fileName,
      routeId: document.route?.formatId || document.route?.id || "unknown",
      sourceFormat: profile.sourceFormat || document.elementPlan?.sourceFormat || document.extension || "",
      professionalFamily: profile.professionalFamily || "generic",
      parserProfile: profile.parserProfile || "",
      parserStages: profile.parserStages || [],
      structureUnits: profile.structureUnits || [],
      adaptationLevel: document.elementPlan?.strategy ? "native-structure-elements" : "text-window-fallback",
      humanReadableTargets: profile.humanReadableModes || [],
      agentReadableTargets: profile.agentReadableModes || [],
      conversionTargets: profile.conversionTargets || [],
      targetFormats: uniqueOrdered(conversionAdapters.map((adapter) => adapter.targetFormat)),
      conversionAdapters,
      qualityGates: profile.qualityGates || [],
      qualityGateResults,
      qualityGateStatusCounts: qualityGateStatusCounts(qualityGateResults),
      conversionRiskLevel: conversionRiskLevel(qualityGateResults),
      riskControls: profile.riskControls || [],
      preserves: profile.preserves || [],
      knownLosses: profile.knownLosses || [],
      evidence,
      openability: {
        markdownUtf8: (profile.humanReadableModes || []).includes("portable-markdown"),
        docxOpenXmlPackage: conversionAdapters.some((adapter) => adapter.targetFormat === "docx"),
        agentJson: (profile.agentReadableModes || []).includes("agent-message-json"),
        workspacePackage: true
      }
    };
  });
  const professionalFormats = uniqueOrdered(plannedDocuments.map((document) => document.routeId).filter((routeId) => (
    PROFESSIONAL_FORMAT_ORDER.includes(routeId)
  )));
  return {
    protocolVersion: `${PROTOCOL_VERSION}.format-conversion-plan`,
    strategy: "office-document-professional-adaptation.v1",
    runId,
    generatedAt: nowIso(),
    humanReadableTargets: uniqueOrdered(plannedDocuments.flatMap((document) => document.humanReadableTargets)),
    agentReadableTargets: uniqueOrdered(plannedDocuments.flatMap((document) => document.agentReadableTargets)),
    professionalFormats,
    formatMatrix: professionalFormatMatrix(professionalFormats.length ? professionalFormats : PROFESSIONAL_FORMAT_ORDER),
    summary: {
      documentCount: plannedDocuments.length,
      documentWithElementPlanCount: plannedDocuments.filter((document) => document.evidence.elementCount > 0).length,
      documentWithGeometryCount: plannedDocuments.filter((document) => document.evidence.geometryElementCount > 0).length,
      documentWithCellRefsCount: plannedDocuments.filter((document) => document.evidence.cellRefCount > 0).length,
      documentWithSheetRefsCount: plannedDocuments.filter((document) => document.evidence.sheetRefCount > 0).length,
      documentWithDefinedNameRefsCount: plannedDocuments.filter((document) => document.evidence.definedNameRefCount > 0).length,
      documentWithNamedRangeRefsCount: plannedDocuments.filter((document) => document.evidence.namedRangeRefCount > 0).length,
      documentWithPrintAreaRefsCount: plannedDocuments.filter((document) => document.evidence.printAreaRefCount > 0).length,
      documentWithDateCellRefsCount: plannedDocuments.filter((document) => document.evidence.dateCellRefCount > 0).length,
      documentWithMergedCellRefsCount: plannedDocuments.filter((document) => document.evidence.mergeRefCount > 0).length,
      documentWithSpreadsheetCommentRefsCount: plannedDocuments.filter((document) => document.evidence.spreadsheetCommentRefCount > 0).length,
      documentWithFormulaRefsCount: plannedDocuments.filter((document) => document.evidence.formulaRefCount > 0).length,
      documentWithLinkRefsCount: plannedDocuments.filter((document) => document.evidence.linkElementCount > 0 || document.evidence.hyperlinkRefCount > 0).length,
      documentWithImageRefsCount: plannedDocuments.filter((document) => document.evidence.imageRefCount > 0).length,
      documentWithChartRefsCount: plannedDocuments.filter((document) => document.evidence.chartRefCount > 0).length,
      documentWithChartSeriesRefsCount: plannedDocuments.filter((document) => document.evidence.chartSeriesRefCount > 0).length,
      documentWithStyleRefsCount: plannedDocuments.filter((document) => document.evidence.styleRefCount > 0).length,
      documentWithNumberingRefsCount: plannedDocuments.filter((document) => document.evidence.numberingRefCount > 0).length,
      documentWithContentControlRefsCount: plannedDocuments.filter((document) => document.evidence.contentControlRefCount > 0).length,
      documentWithBookmarkRefsCount: plannedDocuments.filter((document) => document.evidence.bookmarkRefCount > 0).length,
      documentWithHeaderFooterRefsCount: plannedDocuments.filter((document) => document.evidence.headerFooterRefCount > 0).length,
      documentWithPresentationLayoutRefsCount: plannedDocuments.filter((document) => document.evidence.presentationLayoutRefCount > 0).length,
      documentWithPresentationMasterRefsCount: plannedDocuments.filter((document) => document.evidence.presentationMasterRefCount > 0).length,
      documentWithPresentationInheritanceRefsCount: plannedDocuments.filter((document) => document.evidence.presentationLayoutRefCount > 0 || document.evidence.presentationMasterRefCount > 0).length,
      documentWithVisioShapeRefsCount: plannedDocuments.filter((document) => document.evidence.visioShapeRefCount > 0).length,
      documentWithVisioConnectorRefsCount: plannedDocuments.filter((document) => document.evidence.visioConnectorRefCount > 0).length,
      documentWithAnnotationsCount: plannedDocuments.filter((document) => document.evidence.annotationElementCount > 0).length,
      documentWithRevisionRefsCount: plannedDocuments.filter((document) => document.evidence.revisionRefCount > 0).length,
      documentWithPdfOutlineRefsCount: plannedDocuments.filter((document) => document.evidence.pdfOutlineRefCount > 0).length,
      documentWithPdfFormFieldRefsCount: plannedDocuments.filter((document) => document.evidence.pdfFormFieldRefCount > 0).length,
      documentWithFrontmatterRefsCount: plannedDocuments.filter((document) => document.evidence.frontmatterRefCount > 0).length,
      documentWithCodeBlockRefsCount: plannedDocuments.filter((document) => document.evidence.codeBlockRefCount > 0).length,
      documentWithBlockquoteRefsCount: plannedDocuments.filter((document) => document.evidence.blockquoteRefCount > 0).length,
      documentWithPresentationCommentRefsCount: plannedDocuments.filter((document) => document.evidence.presentationCommentRefCount > 0).length,
      targetFormats: uniqueOrdered(plannedDocuments.flatMap((document) => document.targetFormats)),
      qualityGates: uniqueOrdered(plannedDocuments.flatMap((document) => document.qualityGates)).slice(0, 80),
      qualityGateStatusCounts: qualityGateStatusCounts(plannedDocuments.flatMap((document) => document.qualityGateResults)),
      documentWithHighConversionRiskCount: plannedDocuments.filter((document) => document.conversionRiskLevel === "high").length,
      documentWithMediumConversionRiskCount: plannedDocuments.filter((document) => document.conversionRiskLevel === "medium").length,
      knownLosses: uniqueOrdered(plannedDocuments.flatMap((document) => document.knownLosses)).slice(0, 80)
    },
    documents: plannedDocuments
  };
}

function streamParserStage(route = null, metadata = {}) {
  if (route?.id === "markdown") return "text.markdown";
  if (route?.id === "markup") return "markup.structure";
  if (route?.id === "source-code") return "code.structure";
  if (route?.id === "config") return "config.key-value";
  if (route?.id === "diagram") return "diagram.structure";
  if (route?.id === "notebook") return "notebook.cells";
  if (route?.id === "diff") return "diff.unified";
  if (route?.id === "calendar") return "calendar.ics";
  if (route?.id === "transcript") return "transcript.cues";
  if (route?.id === "financial-report") return "xbrl.facts";
  if (route?.id === "spreadsheet" && metadata.extension === ".csv") return "table.csv";
  if (route?.id === "spreadsheet" && metadata.extension === ".tsv") return "table.tsv";
  if (route?.id === "json" && [".jsonl", ".ndjson"].includes(normalizeExtension(metadata.extension || ""))) return "structured.jsonl";
  if (route?.id === "json") return "structured.json.file-ref-stream";
  return "text.direct";
}

function transformStreamingTextChunk(chunk = "", route = null, metadata = {}) {
  if (route?.id === "json") {
    return parseJsonLike(chunk) || String(chunk || "");
  }
  if (route?.id === "config") {
    return parseConfigText(chunk, metadata).text || String(chunk || "");
  }
  if (route?.id === "diagram") {
    return parseDiagramText(chunk, metadata).text || String(chunk || "");
  }
  if (route?.id === "notebook") {
    return parseNotebookText(chunk).text || String(chunk || "");
  }
  if (route?.id === "source-code") {
    return parseSourceCodeText(chunk, metadata).text || String(chunk || "");
  }
  if (route?.id === "diff") {
    return parseUnifiedDiffText(chunk).text || String(chunk || "");
  }
  if (route?.id === "calendar") {
    return parseCalendarText(chunk).text || String(chunk || "");
  }
  if (route?.id === "transcript") {
    return parseTranscriptText(chunk, metadata).text || String(chunk || "");
  }
  if (route?.id === "financial-report") {
    return parseXbrlText(chunk, metadata).text || String(chunk || "");
  }
  if (route?.id === "markup") {
    return parseMarkupText(chunk, metadata).text || String(chunk || "");
  }
  return String(chunk || "");
}

function plainTextRoute() {
  return ROUTES_BY_MEDIA_TYPE.get("text/plain") || ROUTES_BY_EXTENSION.get(".txt");
}

function streamTextFileAnalysis({ document = {}, route = null, metadata = {}, filePath = "", options = {} } = {}) {
  const { maxCharacters, overlapCharacters } = normalizedWindowOptions(options);
  const windows = [];
  const hash = crypto.createHash("sha256");
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  let file = null;
  let carry = "";
  let carryStartOffset = 0;
  let totalCharacters = 0;
  let sample = "";
  const pushWindows = (flush = false) => {
    while (carry.length >= maxCharacters || (flush && carry.trim())) {
      const end = flush && carry.length < maxCharacters
        ? carry.length
        : selectWindowEnd(carry, maxCharacters);
      const chunk = carry.slice(0, end).trim();
      if (chunk) {
        windows.push(buildWindowRecord(document, windows.length, carryStartOffset, carryStartOffset + end, chunk));
      }
      if (end >= carry.length) {
        carryStartOffset += end;
        carry = "";
        break;
      }
      const advance = Math.max(1, end - overlapCharacters);
      carry = carry.slice(advance);
      carryStartOffset += advance;
    }
  };
  try {
    file = fsSync.openSync(filePath, "r");
    while (true) {
      const bytesRead = fsSync.readSync(file, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      const decoded = decoder.decode(bytes, { stream: true });
      const transformed = transformStreamingTextChunk(decoded, route, metadata);
      totalCharacters += transformed.length;
      if (sample.length < STREAM_TEXT_SAMPLE_CHARACTERS) {
        sample += transformed.slice(0, STREAM_TEXT_SAMPLE_CHARACTERS - sample.length);
      }
      carry += transformed;
      pushWindows(false);
    }
    const tail = transformStreamingTextChunk(decoder.decode(), route, metadata);
    if (tail) {
      totalCharacters += tail.length;
      if (sample.length < STREAM_TEXT_SAMPLE_CHARACTERS) {
        sample += tail.slice(0, STREAM_TEXT_SAMPLE_CHARACTERS - sample.length);
      }
      carry += tail;
    }
    pushWindows(true);
  } finally {
    if (file !== null) {
      fsSync.closeSync(file);
    }
  }
  const parserStage = streamParserStage(route, metadata);
  return {
    textSample: sample.trim(),
    totalCharacters,
    contentHash: `sha256:${hash.digest("hex")}`,
    windowPlan: {
      strategy: "file-ref-stream-windowing.v1",
      maxCharacters,
      overlapCharacters,
      windowCount: windows.length,
      truncated: false,
      source: {
        kind: "file-ref",
        byteSize: document.byteSize || 0,
        chunkBytes: STREAM_TEXT_CHUNK_BYTES,
        sampleCharacters: Math.min(sample.length, STREAM_TEXT_SAMPLE_CHARACTERS),
        totalCharacters
      },
      windows
    },
    parserTrace: [
      {
        stage: "payload.stream-text",
        status: totalCharacters ? "completed" : "empty",
        path: filePath,
        bytes: document.byteSize || 0,
        characters: totalCharacters,
        windows: windows.length,
        chunkBytes: STREAM_TEXT_CHUNK_BYTES
      },
      {
        stage: parserStage,
        status: sample.trim() ? "completed" : "empty",
        mode: "streaming-sample",
        characters: sample.trim().length
      }
    ],
    warnings: sample.length >= STREAM_TEXT_SAMPLE_CHARACTERS ? ["streaming-text-sample-truncated"] : []
  };
}

function byteEntropyScore(buffer = Buffer.alloc(0)) {
  if (!buffer.length) {
    return 0;
  }
  const counts = new Map();
  for (const byte of buffer) {
    counts.set(byte, (counts.get(byte) || 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / buffer.length;
    entropy -= probability * Math.log2(probability);
  }
  return Number((entropy / 8).toFixed(4));
}

function readBinarySample(filePath = "", byteSize = 0) {
  const sampleBytes = Math.min(BINARY_PROFILE_SAMPLE_BYTES, Math.max(0, byteSize));
  if (!sampleBytes) {
    return { head: Buffer.alloc(0), tail: Buffer.alloc(0) };
  }
  const head = Buffer.alloc(sampleBytes);
  const tail = Buffer.alloc(sampleBytes);
  let file = null;
  try {
    file = fsSync.openSync(filePath, "r");
    const headBytes = fsSync.readSync(file, head, 0, sampleBytes, 0);
    const tailOffset = Math.max(0, byteSize - sampleBytes);
    const tailBytes = fsSync.readSync(file, tail, 0, sampleBytes, tailOffset);
    return {
      head: head.subarray(0, headBytes),
      tail: tail.subarray(0, tailBytes)
    };
  } finally {
    if (file !== null) {
      fsSync.closeSync(file);
    }
  }
}

function hashFileStreaming(filePath = "") {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.alloc(STREAM_TEXT_CHUNK_BYTES);
  let file = null;
  let bytes = 0;
  try {
    file = fsSync.openSync(filePath, "r");
    while (true) {
      const bytesRead = fsSync.readSync(file, buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      bytes += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    if (file !== null) {
      fsSync.closeSync(file);
    }
  }
  return {
    bytes,
    contentHash: `sha256:${hash.digest("hex")}`
  };
}

function parseBinaryFileProfile({ document = {}, metadata = {}, route = null, filePath = "" } = {}) {
  const stat = fsSync.statSync(filePath);
  const hashed = hashFileStreaming(filePath);
  const sample = readBinarySample(filePath, stat.size);
  const sampleBuffer = Buffer.concat([sample.head, sample.tail]);
  const headHex = sample.head.toString("hex").slice(0, 128);
  const tailHex = sample.tail.toString("hex").slice(0, 128);
  return {
    text: "",
    totalCharacters: 0,
    contentHash: hashed.contentHash,
    windowPlan: null,
    parserTrace: [{
      stage: "payload.file-ref-binary-profile",
      status: "completed",
      strategy: "bounded-binary-file-profile.v1",
      path: filePath,
      bytes: stat.size,
      hashedBytes: hashed.bytes,
      routeId: route?.id || "unknown",
      extension: metadata.extension || "",
      mediaType: metadata.mediaType || "",
      sampleBytes: sampleBuffer.length,
      headHex,
      tailHex,
      entropyScore: byteEntropyScore(sampleBuffer),
      directReadAvoided: stat.size > FILE_REF_DIRECT_READ_MAX_BYTES,
      maxDirectReadBytes: FILE_REF_DIRECT_READ_MAX_BYTES
    }],
    warnings: ["binary-profile-only"]
  };
}

function parsePdfFileRef({ document = {}, metadata = {}, filePath = "", runtimeStatus = null, options = {} } = {}) {
  const runtime = runtimeStatus?.runtimes?.["pdf.pdftotext"];
  if (!runtime?.available) {
    const pdfProfile = buildPdfSubtypeProfile({
      source: "file-ref-pdftotext",
      byteSize: document.byteSize || 0,
      parserWarnings: ["missing-runtime:pdf.pdftotext"]
    });
    return {
      text: "",
      totalCharacters: 0,
      contentHash: "",
      windowPlan: null,
      parserTrace: [runtimeStageTrace("pdf.text.pdftotext", runtimeStatus, "pdf.pdftotext"), pdfSubtypeTrace(pdfProfile)],
      warnings: ["missing-runtime:pdf.pdftotext"],
      pdfProfile
    };
  }
  const workDir = tempWorkDir("external-kd-pdf-text-");
  const outputPath = path.join(workDir, "pdf-text.txt");
  try {
    const inputStat = fsSync.statSync(filePath);
    execFileSync(runtime.command || "pdftotext", ["-layout", "-enc", "UTF-8", filePath, outputPath], {
      encoding: "utf8",
      timeout: TIKA_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    });
    let basicParse = null;
    const basicWarnings = [];
    if (inputStat.size <= FILE_REF_DIRECT_READ_MAX_BYTES) {
      try {
        basicParse = parsePdfBasicText(fsSync.readFileSync(filePath));
      } catch (error) {
        basicWarnings.push(`pdf-basic-structure-failed:${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      basicWarnings.push("pdf-basic-structure-skipped-large-file-ref");
    }
    const stat = fsSync.existsSync(outputPath) ? fsSync.statSync(outputPath) : { size: 0 };
    const stream = stat.size > 0
      ? streamTextFileAnalysis({
          document,
          route: plainTextRoute(),
          metadata: { ...metadata, extension: ".txt", mediaType: "text/plain", fileName: "pdf-text.txt" },
          filePath: outputPath,
          options
        })
      : {
          textSample: "",
          totalCharacters: 0,
          contentHash: "",
          windowPlan: null,
          parserTrace: [],
          warnings: ["pdf-pdftotext-empty"]
        };
    const pdfProfile = buildPdfSubtypeProfile({
      source: "file-ref-pdftotext",
      byteSize: document.byteSize || inputStat.size || 0,
      textCharacters: stream.totalCharacters || 0,
      layoutBlocks: basicParse?.elements?.filter((element) => element.type === "pdf-text-block").length || 0,
      parserWarnings: [...(stream.warnings || []), ...(basicParse?.warnings || []), ...basicWarnings]
    });
    return {
      text: stream.textSample || "",
      totalCharacters: stream.totalCharacters || 0,
      contentHash: stream.contentHash || "",
      windowPlan: stream.windowPlan || null,
      structureElements: basicParse?.elements || [],
      structureFormat: basicParse?.format || (basicParse?.elements?.length ? "pdf" : ""),
      parserTrace: [
        {
          stage: "pdf.text.pdftotext",
          status: stream.totalCharacters ? "completed" : "empty",
          runtime: "pdf.pdftotext",
          command: runtime.command || "pdftotext",
          bytes: document.byteSize || inputStat.size || 0,
          characters: stream.totalCharacters || 0,
          windows: stream.windowPlan?.windowCount || 0
        },
        ...(basicParse?.parserTrace || []),
        pdfSubtypeTrace(pdfProfile),
        ...stream.parserTrace
      ],
      warnings: [...(stream.warnings || []), ...(basicParse?.warnings || []), ...basicWarnings],
      pdfProfile
    };
  } catch (error) {
    const pdfProfile = buildPdfSubtypeProfile({
      source: "file-ref-pdftotext",
      byteSize: document.byteSize || 0,
      parserWarnings: ["pdf-pdftotext-failed"]
    });
    return {
      text: "",
      totalCharacters: 0,
      contentHash: "",
      windowPlan: null,
      parserTrace: [{
        stage: "pdf.text.pdftotext",
        status: "failed",
        runtime: "pdf.pdftotext",
        command: runtime.command || "pdftotext",
        error: error instanceof Error ? error.message : String(error)
      }, pdfSubtypeTrace(pdfProfile)],
      warnings: ["pdf-pdftotext-failed"],
      pdfProfile
    };
  } finally {
    fsSync.rmSync(workDir, { recursive: true, force: true });
  }
}

function parseTikaFileRef({ document = {}, metadata = {}, filePath = "", runtimeStatus = null, options = {} } = {}) {
  const workDir = tempWorkDir("external-kd-tika-file-");
  const outputPath = path.join(workDir, "tika-text.txt");
  const tikaStage = isMsgRoute(ROUTES_BY_EXTENSION.get(normalizeExtension(metadata.extension || extensionFromFileName(metadata.fileName || ""))) || null, metadata)
    ? "email.msg.tika.file-ref"
    : "tika.text.file-ref";
  try {
    const tika = runTikaFileToTextFile(filePath, outputPath, metadata, runtimeStatus, tikaStage);
    const hasText = fsSync.existsSync(outputPath) && fsSync.statSync(outputPath).size > 0;
    const stream = hasText
      ? streamTextFileAnalysis({
          document,
          route: plainTextRoute(),
          metadata: { ...metadata, extension: ".txt", mediaType: "text/plain", fileName: "tika-text.txt" },
          filePath: outputPath,
          options
        })
      : {
          textSample: "",
          totalCharacters: 0,
          contentHash: "",
          windowPlan: null,
          parserTrace: [],
          warnings: []
        };
    return {
      text: stream.textSample || "",
      totalCharacters: stream.totalCharacters || 0,
      contentHash: stream.contentHash || "",
      windowPlan: stream.windowPlan || null,
      parserTrace: [...tika.parserTrace, ...stream.parserTrace],
      warnings: [...tika.warnings, ...(stream.warnings || [])]
    };
  } finally {
    fsSync.rmSync(workDir, { recursive: true, force: true });
  }
}

function parseMboxFileRef({ filePath = "" } = {}) {
  try {
    const parsed = readMboxMessagesFromFile(filePath);
    const summaries = parsed.messages.map(mboxMessageSummary);
    const text = [
      `MBOX messages: ${summaries.length}`,
      ...summaries.map((summary) => [
        `Message ${summary.index}: ${summary.subject}`,
        summary.from ? `From: ${summary.from}` : "",
        summary.to ? `To: ${summary.to}` : "",
        summary.date ? `Date: ${summary.date}` : "",
        `Attachments: ${summary.attachmentCount}`,
        summary.excerpt
      ].filter(Boolean).join("\n"))
    ].filter(Boolean).join("\n\n");
    return {
      text,
      totalCharacters: text.length,
      contentHash: parsed.contentHash,
      windowPlan: null,
      messages: parsed.messages,
      parserTrace: [{
        stage: "email.mbox",
        status: parsed.messages.length ? "completed" : "empty",
        mode: "file-ref",
        path: filePath,
        messages: parsed.messages.length,
        maxMessages: EMAIL_MBOX_MAX_MESSAGES,
        truncated: parsed.truncated
      }],
      warnings: parsed.truncated ? ["mbox-message-limit-reached"] : []
    };
  } catch (error) {
    return {
      text: "",
      totalCharacters: 0,
      contentHash: "",
      windowPlan: null,
      messages: [],
      parserTrace: [{
        stage: "email.mbox",
        status: "failed",
        mode: "file-ref",
        path: filePath,
        error: error instanceof Error ? error.message : String(error)
      }],
      warnings: ["mbox-file-ref-failed"]
    };
  }
}

function parseStructuredZipFileRef({ document = {}, metadata = {}, route = null, filePath = "", runtimeStatus = null, options = {} } = {}) {
  const stage = structuredZipStage(route);
  const extracted = extractZipFileToDirectory(filePath, runtimeStatus, "structured-zip.file-ref.extract");
  const parserTrace = [...extracted.parserTrace];
  const warnings = [...extracted.warnings];
  if (warnings.some((warning) => warning.includes("extract-failed") || warning.includes("missing-runtime"))) {
    extracted.cleanup?.();
    return {
      text: "",
      totalCharacters: 0,
      contentHash: "",
      windowPlan: null,
      parserTrace,
      warnings
    };
  }
  const outputDir = tempWorkDir("external-kd-structured-text-");
  const outputPath = path.join(outputDir, "structured-text.txt");
  let totalCharacters = 0;
  let structuredFileCount = 0;
  let directText = "";
  let structureElements = [];
  let structureFormat = "";
  try {
    const entryPlan = structuredZipDirectoryEntryPlan(route, extracted.outputDir);
    parserTrace.push(structuredZipEntryPlanTrace(entryPlan));
    if (entryPlan.skippedLargeFileCount > 0) {
      warnings.push("structured-zip-large-entry-stream-fallback");
    }
    const canUseBoundedEntries = entryPlan.skippedLargeFileCount === 0;
    if (route?.id === "word") {
      const parsed = canUseBoundedEntries
        ? parseDocx(entryPlan.entries)
        : { text: "", elements: [], format: "docx", xmlFileCount: entryPlan.selectedFileCount };
      if (parsed.text && canUseBoundedEntries) {
        directText = parsed.text;
        totalCharacters = directText.length;
        structuredFileCount = parsed.xmlFileCount;
        structureElements = parsed.elements || [];
        structureFormat = parsed.format || "docx";
        parserTrace.push({
          stage,
          status: "completed",
          mode: "structured-zip-file-ref",
          files: structuredFileCount,
          characters: totalCharacters,
          elements: structureElements.length,
          paragraphs: parsed.paragraphCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          contentControls: parsed.contentControlCount,
          bookmarks: parsed.bookmarkCount,
          annotations: parsed.annotationCount,
          comments: parsed.commentCount,
          footnotes: parsed.footnoteCount,
          endnotes: parsed.endnoteCount,
          revisions: parsed.revisionCount,
          insertedRevisions: parsed.insertionRevisionCount,
          deletedRevisions: parsed.deletionRevisionCount,
          links: parsed.hyperlinkCount,
          images: parsed.imageCount,
          headings: parsed.headingCount,
          listItems: parsed.listItemCount,
          styles: parsed.styleRefCount,
          numberingRefs: parsed.numberingRefCount
        });
        parserTrace.push({
          stage: "office.word.styles",
          status: parsed.styleRefCount ? "completed" : "empty",
          styles: parsed.styleRefCount,
          headings: parsed.headingCount,
          listItems: parsed.listItemCount
        });
        parserTrace.push({
          stage: "office.word.numbering",
          status: parsed.numberingRefCount ? "completed" : "empty",
          numberingRefs: parsed.numberingRefCount,
          listItems: parsed.listItemCount
        });
        parserTrace.push({
          stage: "office.word.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount
        });
        parserTrace.push({
          stage: "office.word.content-controls",
          status: parsed.contentControlCount ? "completed" : "empty",
          contentControls: parsed.contentControlCount
        });
        parserTrace.push({
          stage: "office.word.bookmarks",
          status: parsed.bookmarkCount ? "completed" : "empty",
          bookmarks: parsed.bookmarkCount
        });
        parserTrace.push({
          stage: "office.word.annotations",
          status: parsed.annotationCount ? "completed" : "empty",
          annotations: parsed.annotationCount,
          comments: parsed.commentCount,
          footnotes: parsed.footnoteCount,
          endnotes: parsed.endnoteCount
        });
        parserTrace.push({
          stage: "office.word.revisions",
          status: parsed.revisionCount ? "completed" : "empty",
          revisions: parsed.revisionCount,
          inserted: parsed.insertionRevisionCount,
          deleted: parsed.deletionRevisionCount
        });
        parserTrace.push({
          stage: "office.word.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          links: parsed.hyperlinkCount
        });
        parserTrace.push({
          stage: "office.word.images",
          status: parsed.imageCount ? "completed" : "empty",
          images: parsed.imageCount
        });
        parserTrace.push({
          stage: "office.word.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        });
      }
    } else if (route?.id === "spreadsheet") {
      const parsed = canUseBoundedEntries
        ? parseXlsxDetailed(entryPlan.entries)
        : { text: "", elements: [], format: "xlsx", sheetCount: 0 };
      if (parsed.text && canUseBoundedEntries) {
        directText = parsed.text;
        totalCharacters = directText.length;
        structuredFileCount = parsed.sheetCount;
        structureElements = parsed.elements || [];
        structureFormat = parsed.format || "xlsx";
        parserTrace.push({
          stage,
          status: "completed",
          mode: "structured-zip-file-ref",
          files: structuredFileCount,
          characters: totalCharacters,
          elements: structureElements.length,
          sheets: parsed.sheetCount,
          workbookSheets: parsed.workbookSheetCount,
          sheetRefs: parsed.sheetRefCount,
          hiddenSheets: parsed.hiddenSheetCount,
          definedNames: parsed.definedNameCount,
          namedRanges: parsed.namedRangeCount,
          printAreas: parsed.printAreaCount,
          rows: parsed.rowCount,
          cells: parsed.cellCount,
          dateStyles: parsed.dateStyleCount,
          dateCells: parsed.dateCellCount,
          mergedCells: parsed.mergedCellCount,
          comments: parsed.commentCount,
          formulas: parsed.formulaCount,
          hyperlinks: parsed.hyperlinkCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        });
        parserTrace.push({
          stage: "table.workbook.sheets",
          status: parsed.workbookSheetCount ? "completed" : "empty",
          sheets: parsed.workbookSheetCount,
          sheetRefs: parsed.sheetRefCount,
          hiddenSheets: parsed.hiddenSheetCount
        });
        parserTrace.push({
          stage: "table.workbook.defined-names",
          status: parsed.definedNameCount ? "completed" : "empty",
          definedNames: parsed.definedNameCount,
          namedRanges: parsed.namedRangeCount,
          printAreas: parsed.printAreaCount
        });
        parserTrace.push({
          stage: "table.sheet.headers",
          status: parsed.headerRows ? "completed" : "empty",
          headerRows: parsed.headerRows
        });
        parserTrace.push({
          stage: "table.sheet.cells",
          status: parsed.cellCount ? "completed" : "empty",
          cells: parsed.cellCount,
          rows: parsed.rowCount,
          sharedStrings: parsed.sharedStringCount
        });
        parserTrace.push({
          stage: "table.sheet.merged-cells",
          status: parsed.mergedCellCount ? "completed" : "empty",
          mergedCells: parsed.mergedCellCount
        });
        parserTrace.push({
          stage: "table.sheet.comments",
          status: parsed.commentCount ? "completed" : "empty",
          comments: parsed.commentCount
        });
        parserTrace.push({
          stage: "table.sheet.date-styles",
          status: parsed.dateCellCount ? "completed" : parsed.dateStyleCount ? "empty" : "not_applicable",
          dateStyles: parsed.dateStyleCount,
          dateCells: parsed.dateCellCount
        });
        parserTrace.push({
          stage: "table.sheet.formulas",
          status: parsed.formulaCount ? "completed" : "empty",
          formulas: parsed.formulaCount
        });
        parserTrace.push({
          stage: "table.sheet.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          hyperlinks: parsed.hyperlinkCount
        });
        parserTrace.push({
          stage: "table.sheet.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount
        });
      } else {
        const spreadsheet = appendXlsxDirectoryAsText(extracted.outputDir, outputPath);
        totalCharacters = spreadsheet.totalCharacters;
        structuredFileCount = spreadsheet.sheetCount;
        parserTrace.push({
          stage,
          status: totalCharacters ? "completed" : "empty",
          mode: "structured-zip-file-ref",
          extractionMode: entryPlan.skippedLargeFileCount ? "streaming-large-structure-entry" : "streaming-structured-text",
          files: structuredFileCount,
          characters: totalCharacters,
          workbookSheets: spreadsheet.workbookSheetCount,
          sheetRefs: spreadsheet.sheetRefCount,
          hiddenSheets: spreadsheet.hiddenSheetCount,
          definedNames: spreadsheet.definedNameCount,
          namedRanges: spreadsheet.namedRangeCount,
          printAreas: spreadsheet.printAreaCount,
          dateStyles: spreadsheet.dateStyleCount,
          dateCells: spreadsheet.dateCellCount,
          mergedCells: spreadsheet.mergedCellCount,
          comments: spreadsheet.commentCount
        });
        parserTrace.push(...spreadsheet.parserTrace);
      }
    } else if (route?.id === "presentation") {
      const parsed = canUseBoundedEntries
        ? parsePptx(entryPlan.entries)
        : { text: "", elements: [], format: "pptx", slideCount: entryPlan.selectedFileCount };
      if (parsed.text && canUseBoundedEntries) {
        directText = parsed.text || "";
        totalCharacters = directText.length;
        structuredFileCount = parsed.presentationPartCount;
        structureElements = parsed.elements || [];
        structureFormat = parsed.format || "pptx";
        parserTrace.push({
          stage,
          status: totalCharacters ? "completed" : "empty",
          mode: "structured-zip-file-ref",
          files: structuredFileCount,
          characters: totalCharacters,
          elements: structureElements.length,
          slides: parsed.slideCount,
          shapes: parsed.shapeCount,
          placeholders: parsed.placeholderCount,
          shapeMetadata: parsed.shapeMetadataCount,
          geometries: parsed.geometryCount,
          shapeGeometries: parsed.shapeGeometryCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          tableGeometries: parsed.tableGeometryCount,
          speakerNotes: parsed.speakerNoteCount,
          comments: parsed.commentCount,
          commentParts: parsed.commentPartCount,
          commentAuthors: parsed.commentAuthorCount,
          slideLayouts: parsed.slideLayoutPartCount,
          slideMasters: parsed.slideMasterPartCount,
          layoutRefs: parsed.slideLayoutRefCount,
          masterRefs: parsed.slideMasterRefCount,
          hyperlinks: parsed.hyperlinkCount,
          images: parsed.imageCount,
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          chartGeometries: parsed.chartGeometryCount,
          layoutStrategy: parsed.shapeGeometryCount ? "presentationml-shape-geometry.v1" : "",
          headings: parsed.headingCount,
          paragraphs: parsed.paragraphCount
        });
        parserTrace.push({
          stage: "office.presentation.layouts",
          status: parsed.slideLayoutRefCount || parsed.slideMasterRefCount ? "completed" : "empty",
          slideLayouts: parsed.slideLayoutPartCount,
          slideMasters: parsed.slideMasterPartCount,
          layoutRefs: parsed.slideLayoutRefCount,
          masterRefs: parsed.slideMasterRefCount
        });
        parserTrace.push({
          stage: "office.presentation.placeholders",
          status: parsed.placeholderCount ? "completed" : "empty",
          placeholders: parsed.placeholderCount,
          shapeMetadata: parsed.shapeMetadataCount
        });
        parserTrace.push({
          stage: "office.presentation.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount,
          geometries: parsed.tableGeometryCount,
          layoutStrategy: parsed.tableGeometryCount ? "presentationml-table-geometry.v1" : ""
        });
        parserTrace.push({
          stage: "office.presentation.hyperlinks",
          status: parsed.hyperlinkCount ? "completed" : "empty",
          links: parsed.hyperlinkCount
        });
        parserTrace.push({
          stage: "office.presentation.images",
          status: parsed.imageCount ? "completed" : "empty",
          images: parsed.imageCount,
          geometries: parsed.imageGeometryCount
        });
        parserTrace.push({
          stage: "office.presentation.charts",
          status: parsed.chartCount ? "completed" : "empty",
          charts: parsed.chartCount,
          chartParts: parsed.chartPartCount,
          chartSeries: parsed.chartSeriesCount,
          geometries: parsed.chartGeometryCount
        });
        parserTrace.push({
          stage: "office.presentation.speaker-notes",
          status: parsed.speakerNoteCount ? "completed" : "empty",
          notes: parsed.speakerNoteCount
        });
        parserTrace.push({
          stage: "office.presentation.comments",
          status: parsed.commentCount ? "completed" : "empty",
          comments: parsed.commentCount,
          commentParts: parsed.commentPartCount,
          authors: parsed.commentAuthorCount
        });
      }
    } else if (route?.id === "visio") {
      const parsed = canUseBoundedEntries
        ? parseVisio(entryPlan.entries)
        : { text: "", elements: [], format: "vsdx", pageCount: entryPlan.selectedFileCount, shapeCount: 0, textShapeCount: 0, connectorCount: 0, geometryCount: 0 };
      if (parsed.text && canUseBoundedEntries) {
        directText = parsed.text || "";
        totalCharacters = directText.length;
        structuredFileCount = parsed.visioPartCount || entryPlan.selectedFileCount;
        structureElements = parsed.elements || [];
        structureFormat = parsed.format || "vsdx";
        parserTrace.push({
          stage,
          status: totalCharacters ? "completed" : "empty",
          mode: "structured-zip-file-ref",
          files: structuredFileCount,
          characters: totalCharacters,
          elements: structureElements.length,
          pages: parsed.pageCount,
          shapes: parsed.shapeCount,
          textShapes: parsed.textShapeCount,
          connectors: parsed.connectorCount,
          geometries: parsed.geometryCount,
          layoutStrategy: parsed.geometryCount ? "visio-shape-geometry.v1" : ""
        });
        parserTrace.push({
          stage: "office.visio.shapes",
          status: parsed.shapeCount ? "completed" : "empty",
          shapes: parsed.shapeCount,
          textShapes: parsed.textShapeCount,
          geometries: parsed.geometryCount
        });
        parserTrace.push({
          stage: "office.visio.connectors",
          status: parsed.connectorCount ? "completed" : "empty",
          connectors: parsed.connectorCount
        });
      }
    } else if (route?.id === "open-document") {
      const parsed = canUseBoundedEntries
        ? parseOpenDocument(entryPlan.entries)
        : { text: "", elements: [], format: "open-document", xmlFileCount: entryPlan.selectedFileCount };
      if (parsed.text && canUseBoundedEntries) {
        directText = parsed.text || "";
        totalCharacters = directText.length;
        structuredFileCount = parsed.xmlFileCount;
        structureElements = parsed.elements || [];
        structureFormat = parsed.format || "open-document";
        parserTrace.push({
          stage,
          status: totalCharacters ? "completed" : "empty",
          mode: "structured-zip-file-ref",
          files: structuredFileCount,
          characters: totalCharacters,
          elements: structureElements.length,
          headings: parsed.headingCount,
          paragraphs: parsed.paragraphCount,
          tables: parsed.tableCount,
          tableRows: parsed.tableRowCount,
          tableCells: parsed.tableCellCount,
          links: parsed.linkCount
        });
        parserTrace.push({
          stage: "open-document.tables",
          status: parsed.tableCount ? "completed" : "empty",
          tables: parsed.tableCount,
          rows: parsed.tableRowCount,
          cells: parsed.tableCellCount
        });
        parserTrace.push({
          stage: "open-document.hyperlinks",
          status: parsed.linkCount ? "completed" : "empty",
          links: parsed.linkCount
        });
      }
    } else {
      const streamed = appendStructuredZipFilesAsText({ route, rootDir: extracted.outputDir, outputPath });
      structuredFileCount = streamed.fileCount;
      totalCharacters = streamed.totalCharacters;
      parserTrace.push({
        stage,
        status: totalCharacters ? "completed" : "empty",
        mode: "structured-zip-file-ref",
        extractionMode: "streaming-structured-text",
        files: structuredFileCount,
        characters: totalCharacters
      });
    }
    if (!directText && !structureElements.length && totalCharacters === 0 && ["word", "presentation", "visio"].includes(route?.id)) {
      const streamed = appendStructuredZipFilesAsText({ route, rootDir: extracted.outputDir, outputPath });
      structuredFileCount = streamed.fileCount;
      totalCharacters = streamed.totalCharacters;
      parserTrace.push({
        stage: "structured-zip.large-entry-stream",
        status: totalCharacters ? "completed" : "empty",
        reason: entryPlan.skippedLargeFileCount ? "large-structure-entry" : "native-structure-empty",
        routeId: route?.id || "",
        files: structuredFileCount,
        characters: totalCharacters
      });
    }
    const stream = totalCharacters > 0 && !structureElements.length
      ? streamTextFileAnalysis({
          document,
          route: plainTextRoute(),
          metadata: { ...metadata, extension: ".txt", mediaType: "text/plain", fileName: "structured-text.txt" },
          filePath: outputPath,
          options
        })
      : {
          textSample: "",
          totalCharacters: 0,
          contentHash: "",
          windowPlan: null,
          parserTrace: [],
          warnings: []
        };
    return {
      text: directText || stream.textSample || "",
      totalCharacters: totalCharacters || stream.totalCharacters || 0,
      contentHash: directText ? `sha256:${sha(directText)}` : stream.contentHash || "",
      windowPlan: structureElements.length ? null : stream.windowPlan || null,
      structureElements,
      structureFormat,
      parserTrace: [...parserTrace, ...stream.parserTrace],
      warnings: [...warnings, ...(stream.warnings || [])]
    };
  } catch (error) {
    parserTrace.push({
      stage,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      text: "",
      totalCharacters: 0,
      contentHash: "",
      windowPlan: null,
      parserTrace,
      warnings: [...warnings, "structured-zip-file-ref-failed"]
    };
  } finally {
    extracted.cleanup?.();
    fsSync.rmSync(outputDir, { recursive: true, force: true });
  }
}

function buildWindowPlan(document = {}, options = {}) {
  if (document.streamingWindowPlan) {
    return document.streamingWindowPlan;
  }
  const elementAwareWindowPlan = buildElementAwareWindowPlan(document, options);
  if (elementAwareWindowPlan) {
    return elementAwareWindowPlan;
  }
  const text = String(document.text || "");
  const { maxCharacters, overlapCharacters } = normalizedWindowOptions(options);
  if (!text) {
    return {
      strategy: "structure-aware-windowing.v1",
      maxCharacters,
      overlapCharacters,
      windowCount: 0,
      truncated: false,
      windows: []
    };
  }
  const windows = [];
  let start = 0;
  while (start < text.length) {
    const end = start + selectWindowEnd(text.slice(start), maxCharacters);
    const chunk = text.slice(start, end).trim();
    windows.push(buildWindowRecord(document, windows.length, start, end, chunk));
    if (end >= text.length) {
      break;
    }
    start = Math.max(end - overlapCharacters, start + 1);
  }
  return {
    strategy: "structure-aware-windowing.v1",
    maxCharacters,
    overlapCharacters,
    windowCount: windows.length,
    truncated: false,
    windows
  };
}

function buildCorpusPlan(documents = [], input = {}) {
  const plannedDocuments = documents.map((document) => {
    const route = buildDocumentRoute(document);
    const windowPlan = buildWindowPlan(document, input);
    const elementPlan = buildDocumentElementPlan(document, windowPlan);
    const formatConversionProfile = professionalDocumentProfile(route, document, elementPlan);
    const textCharacters = Number(document.totalTextCharacters || document.text.length || 0);
    const distillable = Boolean(document.text || textCharacters > 0 || windowPlan.windowCount > 0);
    return {
      sourceId: document.sourceId,
      parentSourceId: document.parentSourceId || "",
      archivePath: document.archivePath || "",
      archiveDepth: Number(document.archiveDepth || 0),
      title: document.title,
      fileName: document.fileName,
      extension: document.extension,
      mediaType: document.mediaType,
      byteSize: document.byteSize,
      sourceKind: document.sourceKind || "",
      manifestLine: Number(document.manifestLine || 0),
      contentHash: document.contentHash,
      capturedAt: document.capturedAt,
      eventTime: document.eventTime || "",
      documentTime: document.documentTime || "",
      timeRange: document.timeRange || null,
      timeConfidence: Number(document.timeConfidence || 0),
      timeSignals: document.timeSignals || [],
      pdfProfile: document.pdfProfile || null,
      route,
      elementPlan,
      formatConversionProfile,
      windowPlan,
      parserTrace: document.parserTrace || [],
      parseWarnings: document.parseWarnings || [],
      parseStatus: document.parseStatus || (distillable ? "completed" : "empty"),
      directoryPath: document.directoryPath || "",
      quality: {
        suppliedPayloadKind: document.suppliedPayloadKind || "metadata-only",
        hasDistillableText: distillable,
        textCharacters,
        sampledTextCharacters: document.text.length,
        distillable,
        evidenceStrength: distillable
          ? document.suppliedPayloadKind === "text"
            ? "supplied-text"
            : "parsed-payload"
          : "metadata-only"
      }
    };
  });
  return {
    strategy: "route-then-window-corpus.v1",
    allSizePolicy: "streaming-windowed",
    sourceCount: documents.length,
    distillableSourceCount: plannedDocuments.filter((document) => document.quality.distillable).length,
    totalBytes: plannedDocuments.reduce((sum, document) => sum + (document.byteSize || 0), 0),
    totalCharacters: documents.reduce((sum, document) => sum + Number(document.totalTextCharacters || document.text.length || 0), 0),
    elementCount: plannedDocuments.reduce((sum, document) => sum + Number(document.elementPlan?.elementCount || 0), 0),
    windowCount: plannedDocuments.reduce((sum, document) => sum + document.windowPlan.windowCount, 0),
    documents: plannedDocuments
  };
}

function buildRoutePlan(corpusPlan) {
  return {
    strategy: "content-signature-extension-media-shape-routing.v2",
    routeOrder: ["contentSignature", "extension", "mediaType", "sourceKind", "textFallback"],
    supportedExtensions: Array.from(ROUTES_BY_EXTENSION.keys()).sort(),
    documents: corpusPlan.documents.map((document) => document.route)
  };
}

function normalizeDocumentRecord(document = {}, index = 0, runtimeStatus = null, options = {}) {
  const metadata = document?.metadata && typeof document.metadata === "object"
    ? document.metadata
    : {};
  const title =
    String(document?.title || document?.name || metadata.title || options.title || `Source ${index + 1}`).trim() ||
    `Source ${index + 1}`;
  const suppliedText = String(
    document?.text ||
      document?.content ||
      document?.markdown ||
      document?.body ||
      metadata.text ||
      ""
  ).trim();
  const sourceId = String(
    options.sourceId ||
      document?.sourceId ||
      document?.documentId ||
      document?.id ||
      `source-${index + 1}`
  );
  let documentMetadata = options.metadataOverride
    ? { ...options.metadataOverride }
    : normalizeDocumentMetadata(document, metadata, title, suppliedText);
  const candidatePath = options.filePathOverride || contentPathFromDocument(document, { ...metadata, ...documentMetadata });
  const resolvedCandidatePath = candidatePath ? resolveAllowedInputPath(candidatePath) : { path: "", error: "" };
  let resolvedCandidateStat = null;
  if (resolvedCandidatePath.path) {
    try {
      resolvedCandidateStat = fsSync.statSync(resolvedCandidatePath.path);
      if (resolvedCandidateStat.isDirectory()) {
        const currentMediaType = String(documentMetadata.mediaType || "").toLowerCase();
        documentMetadata = {
          ...documentMetadata,
          extension: documentMetadata.extension || ".directory",
          mediaType: !documentMetadata.mediaType || GENERIC_MEDIA_TYPES.has(currentMediaType)
            ? "inode/directory"
            : documentMetadata.mediaType,
          sourceKind: documentMetadata.sourceKind || "directory",
          byteSize: documentMetadata.byteSize || 0
        };
      }
    } catch (_error) {
      resolvedCandidateStat = null;
    }
  }
  let signatureHint = null;
  if (options.bufferOverride) {
    signatureHint = contentSignatureHint(options.bufferOverride);
  } else {
    const inlineBuffer = bufferFromDocument(document, { ...metadata, ...documentMetadata });
    if (inlineBuffer?.length) {
      signatureHint = contentSignatureHint(inlineBuffer);
    } else if (resolvedCandidatePath.path && !resolvedCandidateStat?.isDirectory()) {
      try {
        signatureHint = contentSignatureHint(readFileHeadSample(resolvedCandidatePath.path));
      } catch (_error) {
        signatureHint = null;
      }
    }
  }
  documentMetadata = applySignatureHintToMetadata(documentMetadata, signatureHint);
  const signatureTrace = contentSignatureTrace(signatureHint, documentMetadata);
  let route = lookupFormatRoute(documentMetadata);
  let payload;
  if (options.bufferOverride) {
    payload = {
      buffer: options.bufferOverride,
      suppliedPayloadKind: options.suppliedPayloadKind || "buffer-override",
      parserTrace: [],
      warnings: [],
      byteSize: options.bufferOverride.length
    };
  } else if (options.filePathOverride) {
    const stat = fsSync.statSync(options.filePathOverride);
    const streamText = isStreamableTextRoute(route, documentMetadata);
    const archiveFilePath = isArchiveRoute(route) ? options.filePathOverride : "";
    const directoryPath = stat.isDirectory() && isDirectoryRoute(route) ? options.filePathOverride : "";
    const pdfFilePath = isPdfRoute(route) ? options.filePathOverride : "";
    const structuredZipFilePath = isStructuredZipFileRoute(route, documentMetadata) ? options.filePathOverride : "";
    const mboxFilePath = isMboxRoute(route, documentMetadata) ? options.filePathOverride : "";
    const tikaFilePath = isTikaFileRoute(route, documentMetadata) ? options.filePathOverride : "";
    const hasFileParserPath = streamText || archiveFilePath || directoryPath || pdfFilePath || structuredZipFilePath || mboxFilePath || tikaFilePath;
    const binaryProfileFilePath = !hasFileParserPath && stat.size > FILE_REF_DIRECT_READ_MAX_BYTES ? options.filePathOverride : "";
    payload = {
      buffer: hasFileParserPath || stat.size > FILE_REF_DIRECT_READ_MAX_BYTES
        ? null
        : fsSync.readFileSync(options.filePathOverride),
      suppliedPayloadKind: options.suppliedPayloadKind || (directoryPath ? "directory-entry-file-ref" : streamText ? "archive-entry-file-ref-stream" : "archive-entry-file-ref"),
      filePath: options.filePathOverride,
      archiveFilePath,
      directoryPath,
      pdfFilePath,
      structuredZipFilePath,
      mboxFilePath,
      tikaFilePath,
      binaryProfileFilePath,
      streamText,
      byteSize: stat.size,
      parserTrace: [{
        stage: "payload.file-ref",
        status: "completed",
        path: options.filePathOverride,
        bytes: stat.size,
        mode: directoryPath ? "directory-file-ref" : streamText ? "streaming-windowed" : archiveFilePath ? "archive-file-ref" : pdfFilePath ? "pdf-file-ref" : structuredZipFilePath ? "structured-zip-file-ref" : mboxFilePath ? "mbox-file-ref" : tikaFilePath ? "tika-file-ref" : binaryProfileFilePath ? "bounded-binary-profile" : "archive-entry-file-ref"
      }],
      warnings: []
    };
  } else {
    payload = loadDocumentPayload(document, { ...metadata, ...documentMetadata }, route);
  }
  const buffer = payload.buffer;
  if (payload.byteSize && !(document?.byteSize ?? document?.size ?? metadata.byteSize ?? metadata.size ?? documentMetadata.byteSize)) {
    documentMetadata.byteSize = payload.byteSize;
  }
  if (buffer?.length && !(document?.byteSize ?? document?.size ?? metadata.byteSize ?? metadata.size ?? documentMetadata.byteSize)) {
    documentMetadata.byteSize = buffer.length;
  }
  const streamAnalysis = payload.streamText
    ? streamTextFileAnalysis({
        document: { sourceId, title, byteSize: documentMetadata.byteSize },
        route,
        metadata: documentMetadata,
        filePath: payload.filePath,
        options: options.windowOptions || {}
      })
    : null;
  const pdfFileAnalysis = payload.pdfFilePath
    ? parsePdfFileRef({
        document: { sourceId, title, byteSize: documentMetadata.byteSize },
        metadata: documentMetadata,
        filePath: payload.pdfFilePath,
        runtimeStatus,
        options: options.windowOptions || {}
      })
    : null;
  const structuredZipAnalysis = payload.structuredZipFilePath
    ? parseStructuredZipFileRef({
        document: { sourceId, title, byteSize: documentMetadata.byteSize },
        metadata: documentMetadata,
        route,
        filePath: payload.structuredZipFilePath,
        runtimeStatus,
        options: options.windowOptions || {}
      })
    : null;
  const mboxFileAnalysis = payload.mboxFilePath
    ? parseMboxFileRef({
        filePath: payload.mboxFilePath
      })
    : null;
  const tikaFileAnalysis = payload.tikaFilePath
    ? parseTikaFileRef({
        document: { sourceId, title, byteSize: documentMetadata.byteSize },
        metadata: documentMetadata,
        filePath: payload.tikaFilePath,
        runtimeStatus,
        options: options.windowOptions || {}
      })
    : null;
  const binaryProfileAnalysis = payload.binaryProfileFilePath
    ? parseBinaryFileProfile({
        document: { sourceId, title, byteSize: documentMetadata.byteSize },
        metadata: documentMetadata,
        route,
        filePath: payload.binaryProfileFilePath
      })
    : null;
  const parsed = streamAnalysis
    ? {
        text: streamAnalysis.textSample,
        parserTrace: streamAnalysis.parserTrace,
        warnings: streamAnalysis.warnings,
        structureElements: [],
        structureFormat: "",
        pdfProfile: null
      }
    : pdfFileAnalysis
      ? {
          text: pdfFileAnalysis.text,
          parserTrace: pdfFileAnalysis.parserTrace,
          warnings: pdfFileAnalysis.warnings,
          structureElements: pdfFileAnalysis.structureElements || [],
          structureFormat: pdfFileAnalysis.structureFormat || "",
          pdfProfile: pdfFileAnalysis.pdfProfile || null
        }
    : structuredZipAnalysis
      ? {
          text: structuredZipAnalysis.text,
          parserTrace: structuredZipAnalysis.parserTrace,
          warnings: structuredZipAnalysis.warnings,
          structureElements: structuredZipAnalysis.structureElements || [],
          structureFormat: structuredZipAnalysis.structureFormat || "",
          pdfProfile: null
        }
    : mboxFileAnalysis
      ? {
          text: mboxFileAnalysis.text,
          parserTrace: mboxFileAnalysis.parserTrace,
          warnings: mboxFileAnalysis.warnings,
          structureElements: [],
          structureFormat: "",
          pdfProfile: null
        }
    : tikaFileAnalysis
      ? {
          text: tikaFileAnalysis.text,
          parserTrace: tikaFileAnalysis.parserTrace,
          warnings: tikaFileAnalysis.warnings,
          structureElements: [],
          structureFormat: "",
          pdfProfile: null
        }
    : binaryProfileAnalysis
      ? {
          text: "",
          parserTrace: binaryProfileAnalysis.parserTrace,
          warnings: binaryProfileAnalysis.warnings,
          structureElements: [],
          structureFormat: "",
          pdfProfile: null
        }
    : payload.archiveFilePath && isArchiveRoute(route)
      ? {
          text: "",
          parserTrace: [{
            stage: "archive.file-ref",
            status: "ready",
            path: payload.archiveFilePath,
            bytes: documentMetadata.byteSize
          }],
          warnings: [],
          structureElements: [],
          structureFormat: "",
          pdfProfile: null
        }
    : payload.directoryPath && isDirectoryRoute(route)
      ? {
          text: "",
          parserTrace: [{
            stage: "directory.file-ref",
            status: "ready",
            path: payload.directoryPath
          }],
          warnings: [],
          structureElements: [],
          structureFormat: "",
          pdfProfile: null
        }
    : parseSuppliedContent({ route, metadata: documentMetadata, text: suppliedText, buffer, runtimeStatus });
  const parserTrace = [signatureTrace, ...(payload.parserTrace || []), ...parsed.parserTrace].filter(Boolean);
  const parseWarnings = [...(payload.warnings || []), ...parsed.warnings];
  const text = parsed.text.trim();
  const parsedStructureElements = Array.isArray(parsed.structureElements) ? parsed.structureElements : [];
  const fallbackElements = parsedStructureElements.length
    ? []
    : buildFallbackStructureElementsFromText(text, route, documentMetadata);
  const structureElements = parsedStructureElements.length ? parsedStructureElements : fallbackElements;
  const structureFormat = parsed.structureFormat || (structureElements.length ? fallbackStructureFormat(route, documentMetadata) : "");
  if (!parsedStructureElements.length && structureElements.length) {
    parserTrace.push({
      stage: "document.structure.elements",
      status: "completed",
      format: structureFormat,
      elements: structureElements.length,
      source: "text-lines"
    });
  }
  const totalTextCharacters = streamAnalysis?.totalCharacters || pdfFileAnalysis?.totalCharacters || structuredZipAnalysis?.totalCharacters || mboxFileAnalysis?.totalCharacters || tikaFileAnalysis?.totalCharacters || binaryProfileAnalysis?.totalCharacters || text.length;
  const inferredTime = inferTimeMetadataFromText(text);
  if (inferredTime.timeRange) {
    parserTrace.push({
      stage: "table.time-index",
      status: "completed",
      fields: Array.from(new Set(inferredTime.timeSignals.map((signal) => signal.field))).slice(0, 8),
      from: inferredTime.timeRange.from,
      to: inferredTime.timeRange.to,
      confidence: inferredTime.timeConfidence
    });
  }
  return {
    buffer,
    route,
    document: {
      sourceId,
      parentSourceId: String(options.parentSourceId || document?.parentSourceId || metadata.parentSourceId || ""),
      archivePath: String(options.archivePath || document?.archivePath || metadata.archivePath || ""),
      archiveDepth: Number(options.archiveDepth || document?.archiveDepth || metadata.archiveDepth || 0),
      title,
      fileName: documentMetadata.fileName,
      relativePath: documentMetadata.relativePath,
      extension: documentMetadata.extension,
      mediaType: documentMetadata.mediaType,
      declaredExtension: documentMetadata.declaredExtension || "",
      declaredMediaType: documentMetadata.declaredMediaType || "",
      sniffedExtension: documentMetadata.sniffedExtension || "",
      sniffedMediaType: documentMetadata.sniffedMediaType || "",
      contentSignature: documentMetadata.contentSignature || "",
      contentSignatureConfidence: Number(documentMetadata.contentSignatureConfidence || 0),
      contentSignatureEvidence: documentMetadata.contentSignatureEvidence || [],
      byteSize: documentMetadata.byteSize,
      sourceKind: documentMetadata.sourceKind,
      manifestLine: Number(documentMetadata.manifestLine || 0),
      language: documentMetadata.language,
      eventTime: documentMetadata.eventTime || inferredTime.timeRange?.from || "",
      documentTime: documentMetadata.documentTime,
      timeRange: inferredTime.timeRange,
      timeConfidence: documentMetadata.eventTime ? 1 : inferredTime.timeConfidence,
      timeSignals: inferredTime.timeSignals,
      pdfProfile: parsed.pdfProfile || null,
      text,
      totalTextCharacters,
      structureElements,
      structureFormat,
      streamingWindowPlan: streamAnalysis?.windowPlan || pdfFileAnalysis?.windowPlan || structuredZipAnalysis?.windowPlan || tikaFileAnalysis?.windowPlan || binaryProfileAnalysis?.windowPlan || null,
      archiveFilePath: payload.archiveFilePath || "",
      directoryPath: payload.directoryPath || "",
      pdfFilePath: payload.pdfFilePath || "",
      mboxFilePath: payload.mboxFilePath || "",
      parserTrace,
      parseWarnings,
      parseStatus: totalTextCharacters > 0 ? "completed" : "empty",
      suppliedPayloadKind: suppliedText ? "text" : options.suppliedPayloadKind || payload.suppliedPayloadKind || (buffer?.length ? "base64" : "metadata-only"),
      capturedAt: String(document?.capturedAt || metadata.capturedAt || options.capturedAt || ""),
      contentHash: document?.contentHash || streamAnalysis?.contentHash || pdfFileAnalysis?.contentHash || structuredZipAnalysis?.contentHash || mboxFileAnalysis?.contentHash || tikaFileAnalysis?.contentHash || binaryProfileAnalysis?.contentHash || `sha256:${sha(`${title}\n${text}`)}`
    }
  };
}

function expandArchiveDocuments({ parentDocument, buffer, runtimeStatus, depth = 0, remainingEntries = ARCHIVE_EXPANSION_MAX_ENTRIES } = {}) {
  if (!buffer?.length || depth >= ARCHIVE_EXPANSION_MAX_DEPTH || remainingEntries <= 0) {
    return [];
  }
  const extracted = extractArchiveEntries(buffer, parentDocument, runtimeStatus);
  const entries = extracted.entries
    .filter((entry) => entry.name && !entry.name.endsWith("/") && entry.data?.length)
    .slice(0, remainingEntries);
  const expanded = [];
  for (const [entryIndex, entry] of entries.entries()) {
    if (expanded.length >= remainingEntries) {
      break;
    }
    if ((entry.uncompressedSize || entry.data.length || 0) > ARCHIVE_ENTRY_MAX_BYTES) {
      continue;
    }
    const entryMetadata = metadataForArchiveEntry(entry, parentDocument);
    const sourceId = `${parentDocument.sourceId}!${entry.name}`;
    const normalized = normalizeDocumentRecord({
      sourceId,
      title: entry.name,
      fileName: entryMetadata.fileName,
      relativePath: entryMetadata.relativePath,
      mediaType: entryMetadata.mediaType,
      byteSize: entryMetadata.byteSize,
      sourceKind: "archive-entry"
    }, entryIndex, runtimeStatus, {
      sourceId,
      parentSourceId: parentDocument.sourceId,
      archivePath: entry.name,
      archiveDepth: depth + 1,
      metadataOverride: entryMetadata,
      bufferOverride: entry.data,
      suppliedPayloadKind: "archive-entry",
      capturedAt: parentDocument.capturedAt
    });
    normalized.document.parserTrace.unshift({
      stage: "archive.entry",
      status: "expanded",
      parentSourceId: parentDocument.sourceId,
      entryName: entry.name,
      depth: depth + 1,
      bytes: entry.data.length
    });
    expanded.push(normalized.document);
    if (normalized.route?.id === "archive") {
      const nested = expandArchiveDocuments({
        parentDocument: normalized.document,
        buffer: normalized.buffer,
        runtimeStatus,
        depth: depth + 1,
        remainingEntries: remainingEntries - expanded.length
      });
      expanded.push(...nested.slice(0, remainingEntries - expanded.length));
    }
  }
  return expanded;
}

function expandArchiveFileDocuments({
  parentDocument,
  filePath,
  runtimeStatus,
  depth = 0,
  remainingEntries = ARCHIVE_EXPANSION_MAX_ENTRIES,
  windowOptions = {}
} = {}) {
  if (!filePath || depth >= ARCHIVE_EXPANSION_MAX_DEPTH || remainingEntries <= 0) {
    return { documents: [], parserTrace: [], warnings: [] };
  }
  const extracted = extractArchiveFileEntries(filePath, parentDocument, runtimeStatus, remainingEntries);
  const entries = extracted.entries
    .filter((entry) => entry.name && !entry.name.endsWith("/") && entry.filePath)
    .slice(0, remainingEntries);
  const expanded = [];
  try {
    for (const [entryIndex, entry] of entries.entries()) {
      if (expanded.length >= remainingEntries) {
        break;
      }
      const entryMetadata = metadataForArchiveEntry(entry, parentDocument);
      const sourceId = `${parentDocument.sourceId}!${entry.name}`;
      const normalized = normalizeDocumentRecord({
        sourceId,
        title: entry.name,
        fileName: entryMetadata.fileName,
        relativePath: entryMetadata.relativePath,
        mediaType: entryMetadata.mediaType,
        byteSize: entryMetadata.byteSize,
        sourceKind: "archive-entry"
      }, entryIndex, runtimeStatus, {
        sourceId,
        parentSourceId: parentDocument.sourceId,
        archivePath: entry.name,
        archiveDepth: depth + 1,
        metadataOverride: entryMetadata,
        filePathOverride: entry.filePath,
        suppliedPayloadKind: "archive-entry-file-ref",
        capturedAt: parentDocument.capturedAt,
        windowOptions
      });
      normalized.document.parserTrace.unshift({
        stage: "archive.entry-file-ref",
        status: "expanded",
        parentSourceId: parentDocument.sourceId,
        entryName: entry.name,
        depth: depth + 1,
        bytes: entry.uncompressedSize || entry.compressedSize || 0
      });
      expanded.push(normalized.document);
      if (normalized.route?.id === "archive" && normalized.document.archiveFilePath) {
        const nested = expandArchiveFileDocuments({
          parentDocument: normalized.document,
          filePath: normalized.document.archiveFilePath,
          runtimeStatus,
          depth: depth + 1,
          remainingEntries: remainingEntries - expanded.length,
          windowOptions
        });
        normalized.document.parserTrace.push(...nested.parserTrace);
        normalized.document.parseWarnings.push(...nested.warnings);
        normalized.document.parserTrace.push({
          stage: "archive.file-ref.expand",
          status: nested.documents.length ? "completed" : "empty",
          childDocumentCount: nested.documents.length
        });
        normalized.document.parserTrace.push({
          stage: "archive.expand-route",
          status: nested.documents.length ? "completed" : "empty",
          childDocumentCount: nested.documents.length,
          maxDepth: ARCHIVE_EXPANSION_MAX_DEPTH,
          maxEntries: ARCHIVE_EXPANSION_MAX_ENTRIES
        });
        expanded.push(...nested.documents.slice(0, remainingEntries - expanded.length));
      }
    }
    return { documents: expanded, parserTrace: extracted.parserTrace, warnings: extracted.warnings };
  } finally {
    extracted.cleanup?.();
  }
}

function shouldSkipDirectoryName(name = "") {
  return DIRECTORY_IGNORED_NAMES.has(String(name || ""));
}

function collectDirectoryFileEntries(rootDir = "", {
  maxFiles = DIRECTORY_EXPANSION_MAX_FILES,
  maxDepth = DIRECTORY_EXPANSION_MAX_DEPTH
} = {}) {
  const root = path.resolve(rootDir);
  const entries = [];
  const warnings = [];
  const stack = [{ absolutePath: root, relativePath: "", depth: 0 }];
  let skippedDirectoryCount = 0;
  let skippedFileCount = 0;
  let totalBytes = 0;
  while (stack.length && entries.length < maxFiles) {
    const current = stack.pop();
    let dirents = [];
    try {
      dirents = fsSync.readdirSync(current.absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (_error) {
      warnings.push(`directory-read-failed:${current.relativePath || "."}`);
      continue;
    }
    for (const dirent of dirents) {
      const absolutePath = path.join(current.absolutePath, dirent.name);
      const relativePath = current.relativePath ? path.join(current.relativePath, dirent.name) : dirent.name;
      if (dirent.isDirectory()) {
        if (shouldSkipDirectoryName(dirent.name) || current.depth + 1 > maxDepth) {
          skippedDirectoryCount += 1;
          continue;
        }
        stack.push({ absolutePath, relativePath, depth: current.depth + 1 });
        continue;
      }
      if (!dirent.isFile()) {
        skippedFileCount += 1;
        continue;
      }
      let stat = null;
      try {
        stat = fsSync.statSync(absolutePath);
      } catch (_error) {
        skippedFileCount += 1;
        continue;
      }
      totalBytes += stat.size;
      if (entries.length >= maxFiles) {
        skippedFileCount += 1;
        continue;
      }
      entries.push({
        absolutePath,
        relativePath: relativePath.replace(/\\/g, "/"),
        fileName: dirent.name,
        byteSize: stat.size,
        depth: current.depth + 1
      });
    }
  }
  if (stack.length) {
    skippedDirectoryCount += stack.length;
  }
  if (skippedDirectoryCount) {
    warnings.push("directory-expansion-directory-limit-or-ignore");
  }
  if (skippedFileCount || entries.length >= maxFiles) {
    warnings.push("directory-expansion-file-limit-or-skip");
  }
  return {
    strategy: "directory-file-ref-recursive-routing.v1",
    root,
    maxFiles,
    maxDepth,
    fileCount: entries.length,
    skippedDirectoryCount,
    skippedFileCount,
    totalBytes,
    entries: entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    warnings
  };
}

function metadataForDirectoryEntry(entry = {}, parentDocument = {}) {
  const extension = extensionFromFileName(entry.fileName || entry.relativePath || "");
  return {
    title: entry.relativePath || entry.fileName || "Directory entry",
    fileName: entry.fileName || path.basename(entry.relativePath || ""),
    relativePath: entry.relativePath || entry.fileName || "",
    extension,
    mediaType: mediaTypeForExtension(extension),
    byteSize: entry.byteSize || 0,
    sourceKind: "directory-entry",
    parentSourceId: parentDocument.sourceId || "",
    archivePath: entry.relativePath || "",
    eventTime: parentDocument.eventTime || "",
    documentTime: parentDocument.documentTime || parentDocument.capturedAt || ""
  };
}

function expandDirectoryDocuments({
  parentDocument,
  directoryPath,
  runtimeStatus,
  remainingFiles = DIRECTORY_EXPANSION_MAX_FILES,
  windowOptions = {}
} = {}) {
  if (!directoryPath || remainingFiles <= 0) {
    return { documents: [], parserTrace: [], warnings: [] };
  }
  const collected = collectDirectoryFileEntries(directoryPath, {
    maxFiles: remainingFiles,
    maxDepth: DIRECTORY_EXPANSION_MAX_DEPTH
  });
  const expanded = [];
  for (const [entryIndex, entry] of collected.entries.entries()) {
    if (expanded.length >= remainingFiles) {
      break;
    }
    const entryMetadata = metadataForDirectoryEntry(entry, parentDocument);
    const sourceId = `${parentDocument.sourceId}!${entry.relativePath}`;
    const normalized = normalizeDocumentRecord({
      sourceId,
      title: entry.relativePath,
      fileName: entryMetadata.fileName,
      relativePath: entryMetadata.relativePath,
      mediaType: entryMetadata.mediaType,
      byteSize: entryMetadata.byteSize,
      sourceKind: "directory-entry"
    }, entryIndex, runtimeStatus, {
      sourceId,
      parentSourceId: parentDocument.sourceId,
      archivePath: entry.relativePath,
      archiveDepth: Number(parentDocument.archiveDepth || 0) + 1,
      metadataOverride: entryMetadata,
      filePathOverride: entry.absolutePath,
      suppliedPayloadKind: "directory-entry-file-ref",
      capturedAt: parentDocument.capturedAt,
      windowOptions
    });
    normalized.document.parserTrace.unshift({
      stage: "directory.entry-file-ref",
      status: "expanded",
      strategy: collected.strategy,
      parentSourceId: parentDocument.sourceId,
      entryName: entry.relativePath,
      depth: entry.depth,
      bytes: entry.byteSize
    });
    expanded.push(normalized.document);
    if (normalized.route?.id === "archive" && normalized.document.archiveFilePath) {
      const nested = expandArchiveFileDocuments({
        parentDocument: normalized.document,
        filePath: normalized.document.archiveFilePath,
        runtimeStatus,
        depth: Number(normalized.document.archiveDepth || 0),
        remainingEntries: Math.max(0, ARCHIVE_EXPANSION_MAX_ENTRIES - expanded.length),
        windowOptions
      });
      normalized.document.parserTrace.push(...nested.parserTrace);
      normalized.document.parseWarnings.push(...nested.warnings);
      normalized.document.parserTrace.push({
        stage: "archive.file-ref.expand",
        status: nested.documents.length ? "completed" : "empty",
        childDocumentCount: nested.documents.length
      });
      expanded.push(...nested.documents.slice(0, remainingFiles - expanded.length));
    }
  }
  return {
    documents: expanded,
    parserTrace: [{
      stage: "directory.file-ref.expand",
      status: expanded.length ? "completed" : "empty",
      strategy: collected.strategy,
      path: collected.root,
      childDocumentCount: expanded.length,
      discoveredFiles: collected.fileCount,
      totalBytes: collected.totalBytes,
      maxFiles: collected.maxFiles,
      maxDepth: collected.maxDepth,
      skippedDirectories: collected.skippedDirectoryCount,
      skippedFiles: collected.skippedFileCount
    }],
    warnings: collected.warnings
  };
}

function expandEmailAttachmentDocuments({ parentDocument, buffer, runtimeStatus, remainingAttachments = EMAIL_ATTACHMENT_MAX_COUNT } = {}) {
  if (!buffer?.length || remainingAttachments <= 0) {
    return [];
  }
  const parsed = parseMimeMessage(utf8(buffer));
  const attachments = parsed.attachments
    .filter((attachment) => attachment.data?.length)
    .slice(0, remainingAttachments);
  const expanded = [];
  for (const [attachmentIndex, attachment] of attachments.entries()) {
    if (expanded.length >= remainingAttachments || attachment.data.length > EMAIL_ATTACHMENT_MAX_BYTES) {
      continue;
    }
    const attachmentMetadata = metadataForEmailAttachment(attachment, parentDocument);
    const sourceId = `${parentDocument.sourceId}!attachment:${attachmentMetadata.fileName}`;
    const normalized = normalizeDocumentRecord({
      sourceId,
      title: attachmentMetadata.fileName,
      fileName: attachmentMetadata.fileName,
      relativePath: attachmentMetadata.relativePath,
      mediaType: attachmentMetadata.mediaType,
      byteSize: attachmentMetadata.byteSize,
      sourceKind: "email-attachment"
    }, attachmentIndex, runtimeStatus, {
      sourceId,
      parentSourceId: parentDocument.sourceId,
      archivePath: attachmentMetadata.fileName,
      archiveDepth: 1,
      metadataOverride: attachmentMetadata,
      bufferOverride: attachment.data,
      suppliedPayloadKind: "email-attachment",
      capturedAt: parentDocument.capturedAt
    });
    normalized.document.parserTrace.unshift({
      stage: "email.attachment",
      status: "expanded",
      parentSourceId: parentDocument.sourceId,
      attachmentName: attachmentMetadata.fileName,
      bytes: attachment.data.length
    });
    expanded.push(normalized.document);
    if (normalized.route?.id === "archive") {
      const nested = expandArchiveDocuments({
        parentDocument: normalized.document,
        buffer: normalized.buffer,
        runtimeStatus,
        depth: 0,
        remainingEntries: ARCHIVE_EXPANSION_MAX_ENTRIES
      });
      expanded.push(...nested);
    }
  }
  return expanded;
}

function expandMboxMessageDocuments({ parentDocument, buffer = null, runtimeStatus, remainingMessages = EMAIL_MBOX_MAX_MESSAGES } = {}) {
  if (remainingMessages <= 0) {
    return [];
  }
  const sourceMessages = parentDocument.mboxFilePath
    ? readMboxMessagesFromFile(parentDocument.mboxFilePath, remainingMessages).messages
    : splitMboxMessages(utf8(buffer), remainingMessages);
  const expanded = [];
  for (const message of sourceMessages.slice(0, remainingMessages)) {
    const summary = mboxMessageSummary(message);
    const messageBuffer = Buffer.from(message.text || "", "utf8");
    const sourceId = `${parentDocument.sourceId}!message:${message.index}`;
    const normalized = normalizeDocumentRecord({
      sourceId,
      title: summary.subject || `MBOX Message ${message.index}`,
      fileName: `message-${message.index}.eml`,
      mediaType: "message/rfc822",
      byteSize: messageBuffer.length,
      sourceKind: "mbox-message",
      metadata: {
        documentTime: summary.date || "",
        from: summary.from || "",
        to: summary.to || ""
      }
    }, message.index - 1, runtimeStatus, {
      sourceId,
      parentSourceId: parentDocument.sourceId,
      archivePath: `message-${message.index}.eml`,
      archiveDepth: 1,
      bufferOverride: messageBuffer,
      suppliedPayloadKind: "mbox-message",
      capturedAt: parentDocument.capturedAt
    });
    normalized.document.parserTrace.unshift({
      stage: "email.mbox-message",
      status: "expanded",
      parentSourceId: parentDocument.sourceId,
      messageIndex: message.index,
      envelope: message.envelope || "",
      truncated: Boolean(message.truncated),
      bytes: messageBuffer.length
    });
    expanded.push(normalized.document);
    const attachments = expandEmailAttachmentDocuments({
      parentDocument: normalized.document,
      buffer: normalized.buffer,
      runtimeStatus,
      remainingAttachments: EMAIL_ATTACHMENT_MAX_COUNT
    });
    if (attachments.length) {
      normalized.document.parserTrace.push({
        stage: "email.attachment-route",
        status: "completed",
        childDocumentCount: attachments.length,
        maxAttachments: EMAIL_ATTACHMENT_MAX_COUNT
      });
      expanded.push(...attachments);
    }
  }
  return expanded;
}

function distillationDocumentContractRecord(document = {}) {
  const sanitized = { ...document };
  for (const fieldName of PARSER_PAYLOAD_FIELD_NAMES) {
    delete sanitized[fieldName];
  }
  sanitized.documentInputContract = DISTILLATION_DOCUMENT_INPUT_CONTRACT;
  sanitized.parserBoundary = {
    strategy: DOCUMENT_INGESTION_ADAPTER_STRATEGY,
    parserPayloadFieldsStripped: true,
    parserTraceRetained: Array.isArray(document.parserTrace)
  };
  return sanitized;
}

function assertDistillationAlgorithmInputContract(documents = []) {
  const violations = [];
  for (const [index, document] of documents.entries()) {
    for (const fieldName of PARSER_PAYLOAD_FIELD_NAMES) {
      if (Object.prototype.hasOwnProperty.call(document || {}, fieldName)) {
        violations.push(`${document?.sourceId || index}:${fieldName}`);
      }
    }
  }
  if (violations.length) {
    const error = new Error(`Distillation algorithm input contains parser payload fields: ${violations.slice(0, 8).join(", ")}`);
    error.statusCode = 500;
    error.code = "DISTILLATION_INPUT_CONTRACT_VIOLATION";
    throw error;
  }
}

function normalizeDocuments(input = {}, runtimeStatus = null) {
  const inputDocuments = collectInputDocuments(input);
  const documents = inputDocuments.documents;
  const normalizedDocuments = [];
  const windowOptions = {
    maxWindowCharacters: input.maxWindowCharacters,
    windowOverlapCharacters: input.windowOverlapCharacters
  };
  for (const [index, document] of documents.entries()) {
    const normalized = normalizeDocumentRecord(document, index, runtimeStatus, { windowOptions });
    normalizedDocuments.push(normalized.document);
    if (normalized.route?.id === "directory" && normalized.document.directoryPath) {
      const directory = expandDirectoryDocuments({
        parentDocument: normalized.document,
        directoryPath: normalized.document.directoryPath,
        runtimeStatus,
        remainingFiles: DIRECTORY_EXPANSION_MAX_FILES,
        windowOptions
      });
      normalized.document.parserTrace.push(...directory.parserTrace);
      normalized.document.parseWarnings.push(...directory.warnings);
      normalized.document.parserTrace.push({
        stage: "directory.expand-route",
        status: directory.documents.length ? "completed" : "empty",
        childDocumentCount: directory.documents.length,
        maxDepth: DIRECTORY_EXPANSION_MAX_DEPTH,
        maxFiles: DIRECTORY_EXPANSION_MAX_FILES
      });
      normalizedDocuments.push(...directory.documents);
    } else if (normalized.route?.id === "archive" && normalized.document.archiveFilePath) {
      const archive = expandArchiveFileDocuments({
        parentDocument: normalized.document,
        filePath: normalized.document.archiveFilePath,
        runtimeStatus,
        depth: 0,
        remainingEntries: ARCHIVE_EXPANSION_MAX_ENTRIES,
        windowOptions
      });
      normalized.document.parserTrace.push(...archive.parserTrace);
      normalized.document.parseWarnings.push(...archive.warnings);
      normalized.document.parserTrace.push({
        stage: "archive.file-ref.expand",
        status: archive.documents.length ? "completed" : "empty",
        childDocumentCount: archive.documents.length
      });
      normalized.document.parserTrace.push({
        stage: "archive.expand-route",
        status: archive.documents.length ? "completed" : "empty",
        childDocumentCount: archive.documents.length,
        maxDepth: ARCHIVE_EXPANSION_MAX_DEPTH,
        maxEntries: ARCHIVE_EXPANSION_MAX_ENTRIES
      });
      normalizedDocuments.push(...archive.documents);
    } else if (normalized.route?.id === "archive" && normalized.buffer?.length) {
      const children = expandArchiveDocuments({
        parentDocument: normalized.document,
        buffer: normalized.buffer,
        runtimeStatus,
        depth: 0,
        remainingEntries: ARCHIVE_EXPANSION_MAX_ENTRIES
      });
      normalized.document.parserTrace.push({
        stage: "archive.expand-route",
        status: children.length ? "completed" : "empty",
        childDocumentCount: children.length,
        maxDepth: ARCHIVE_EXPANSION_MAX_DEPTH,
        maxEntries: ARCHIVE_EXPANSION_MAX_ENTRIES
      });
      normalizedDocuments.push(...children);
    }
    if (normalized.route?.id === "email" && isMboxRoute(normalized.route, normalized.document) && (normalized.buffer?.length || normalized.document.mboxFilePath)) {
      const children = expandMboxMessageDocuments({
        parentDocument: normalized.document,
        buffer: normalized.buffer,
        runtimeStatus,
        remainingMessages: EMAIL_MBOX_MAX_MESSAGES
      });
      normalized.document.parserTrace.push({
        stage: "email.mbox-route",
        status: children.length ? "completed" : "empty",
        childDocumentCount: children.filter((child) => child.parentSourceId === normalized.document.sourceId).length,
        maxMessages: EMAIL_MBOX_MAX_MESSAGES
      });
      normalizedDocuments.push(...children);
    } else if (normalized.route?.id === "email" && normalized.buffer?.length) {
      const children = expandEmailAttachmentDocuments({
        parentDocument: normalized.document,
        buffer: normalized.buffer,
        runtimeStatus,
        remainingAttachments: EMAIL_ATTACHMENT_MAX_COUNT
      });
      normalized.document.parserTrace.push({
        stage: "email.attachment-route",
        status: children.length ? "completed" : "empty",
        childDocumentCount: children.length,
        maxAttachments: EMAIL_ATTACHMENT_MAX_COUNT
      });
      normalizedDocuments.push(...children);
    }
  }
  return {
    documents: normalizedDocuments.map(distillationDocumentContractRecord),
    inputDocumentPlan: {
      strategy: "inline-or-streaming-manifest-document-input.v1",
      parserAdapterStrategy: DOCUMENT_INGESTION_ADAPTER_STRATEGY,
      documentInputContract: DISTILLATION_DOCUMENT_INPUT_CONTRACT,
      algorithmInputContract: DISTILLATION_ALGORITHM_INPUT_CONTRACT,
      parserPayloadFieldsStripped: true,
      inlineDocumentCount: inputDocuments.inlineDocumentCount,
      inlineDocumentField: inputDocuments.inlineDocumentField,
      inlineDocumentContract: inputDocuments.inlineDocumentContract,
      manifestDocumentCount: inputDocuments.manifestDocumentCount,
      sourceCount: documents.length,
      manifests: inputDocuments.manifests,
      parserTrace: inputDocuments.parserTrace,
      warnings: inputDocuments.warnings
    }
  };
}

function runDocumentParsingModule(input = {}, runtimeStatus = null) {
  const normalizedInput = normalizeDocuments(input, runtimeStatus);
  assertDistillationAlgorithmInputContract(normalizedInput.documents);
  return {
    ...normalizedInput,
    moduleBoundary: DOCUMENT_PARSING_MODULE_BOUNDARY,
    strategy: DOCUMENT_INGESTION_ADAPTER_STRATEGY,
    outputContract: DISTILLATION_DOCUMENT_INPUT_CONTRACT,
    consumedByAlgorithmContract: DISTILLATION_ALGORITHM_INPUT_CONTRACT,
    parserPayloadFieldsStripped: true
  };
}

function bindDocumentParsingToAlgorithmInput(workflowContext = {}, documentParsing = {}) {
  return {
    ...workflowContext,
    allDocuments: documentParsing.documents || [],
    inputDocumentPlan: {
      ...(documentParsing.inputDocumentPlan || {}),
      moduleBoundary: documentParsing.moduleBoundary,
      parserModuleStrategy: documentParsing.strategy,
      outputContract: documentParsing.outputContract,
      consumedByAlgorithmContract: documentParsing.consumedByAlgorithmContract
    },
    documentParsing,
    algorithmInputContract: DISTILLATION_ALGORITHM_INPUT_CONTRACT,
    algorithmModuleBoundary: DISTILLATION_ALGORITHM_MODULE_BOUNDARY
  };
}

function textTokens(value = "") {
  const normalized = String(value || "").toLowerCase();
  const tokens = new Set();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) {
    const token = match[0].replace(/^_+|_+$/g, "");
    if (token.length > 1 && !STOP_WORDS.has(token)) {
      tokens.add(token);
    }
  }
  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const text = match[0];
    if (text.length <= 4) {
      tokens.add(text);
      continue;
    }
    for (let index = 0; index < text.length - 1; index += 1) {
      const token = text.slice(index, index + 2);
      if (!STOP_WORDS.has(token)) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function expandedSemanticTokens(tokens = new Set()) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const [concept, aliases] of Object.entries(SEMANTIC_ALIAS_GROUPS)) {
      if (aliases.includes(token)) {
        expanded.add(`concept:${concept}`);
      }
    }
  }
  return expanded;
}

function tokenHashParts(token = "") {
  const digest = crypto.createHash("sha256").update(String(token)).digest();
  return {
    index: digest.readUInt32LE(0) % EMBEDDING_DIMENSIONS,
    sign: digest[4] % 2 === 0 ? 1 : -1
  };
}

function normalizeVector(vector = []) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  }
  return vector.map((value) => value / magnitude);
}

function vectorForTokens(tokens = new Set()) {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (const token of tokens) {
    if (Object.hasOwn(SEMANTIC_CONCEPT_INDEX, token)) {
      vector[SEMANTIC_CONCEPT_INDEX[token]] += 3;
      continue;
    }
    const { index, sign } = tokenHashParts(token);
    const weight = String(token).startsWith("concept:") ? 1.75 : 1;
    vector[index] += sign * weight;
  }
  return normalizeVector(vector);
}

function vectorForText(value = "") {
  return vectorForTokens(expandedSemanticTokens(textTokens(value)));
}

function cosineSimilarity(left = [], right = []) {
  if (!left.length || !right.length) {
    return 0;
  }
  let dot = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function mergeCentroid(current = [], next = [], count = 1) {
  if (!current.length) {
    return next;
  }
  const merged = current.map((value, index) => ((value * count) + next[index]) / (count + 1));
  return normalizeVector(merged);
}

const STRONG_CLASSIFICATION_CONCEPTS = Object.freeze(new Set([
  "concept:finance"
]));

const CONCEPT_MERGE_MIN_SIMILARITY = Object.freeze({
  "concept:finance": 0.08
});

function strongConceptIntersection(left = new Set(), right = new Set()) {
  const shared = [];
  for (const token of left) {
    if (STRONG_CLASSIFICATION_CONCEPTS.has(token) && right.has(token)) {
      shared.push(token);
    }
  }
  return shared;
}

function mergeWeightedCentroids(left = [], right = [], leftWeight = 1, rightWeight = 1) {
  if (!left.length) {
    return right;
  }
  if (!right.length) {
    return left;
  }
  const total = Math.max(1, leftWeight + rightWeight);
  return normalizeVector(left.map((value, index) => ((value * leftWeight) + (right[index] * rightWeight)) / total));
}

function mergeLeaderGroupsBySemanticConcept(groups = []) {
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        const sharedConcepts = strongConceptIntersection(left.expandedTokens, right.expandedTokens);
        if (!sharedConcepts.length) {
          continue;
        }
        const similarity = cosineSimilarity(left.centroid, right.centroid);
        const canMerge = sharedConcepts.some((concept) => (
          similarity >= (CONCEPT_MERGE_MIN_SIMILARITY[concept] ?? LEADER_CLUSTER_THRESHOLD)
        ));
        if (!canMerge) {
          continue;
        }
        const leftWeight = Math.max(1, left.documents.length);
        const rightWeight = Math.max(1, right.documents.length);
        left.centroid = mergeWeightedCentroids(left.centroid, right.centroid, leftWeight, rightWeight);
        left.documents.push(...right.documents);
        left.cohesionScores.push(...right.cohesionScores);
        left.signalScores.push(...right.signalScores);
        for (const token of right.tokens) {
          left.tokens.add(token);
        }
        for (const token of right.expandedTokens) {
          left.expandedTokens.add(token);
        }
        groups.splice(rightIndex, 1);
        merged = true;
        break outer;
      }
    }
  }
  return groups;
}

function signalStrength({ text = "", tokens = new Set() } = {}) {
  if (!String(text || "").trim()) {
    return 0;
  }
  const tokenScore = Math.min(1, tokens.size / 12);
  const lengthScore = Math.min(1, String(text).trim().length / 180);
  return Number(((tokenScore * 0.65) + (lengthScore * 0.35)).toFixed(4));
}

function topTokens(tokens = new Set(), limit = 4) {
  return Array.from(tokens)
    .filter((token) => !String(token).startsWith("concept:"))
    .filter((token) => token.length > 1)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, limit);
}

function routeConceptBoost(concept = "", routeId = "") {
  return Number(ROUTE_CONCEPT_BOOSTS[routeId]?.[concept] || 0);
}

function documentConceptEvidence(document = {}, concept = "", aliases = []) {
  const routeId = document.route?.formatId || "";
  const documentTokens = textTokens([
    document.title,
    document.fileName,
    String(document.text || "").slice(0, 8_000)
  ].filter(Boolean).join("\n"));
  const directHits = aliases.filter((alias) => documentTokens.has(alias));
  const routeBoost = routeConceptBoost(concept, routeId);
  const score = directHits.length + routeBoost;
  return {
    sourceId: document.sourceId || "",
    routeId,
    score,
    directHits: directHits.slice(0, 6),
    routeBoost
  };
}

function semanticConceptScores(tokens = new Set(), expandedTokens = new Set(), options = {}) {
  const documents = Array.isArray(options.documents) ? options.documents : [];
  return Object.entries(SEMANTIC_ALIAS_GROUPS)
    .map(([concept, aliases]) => {
      const directHits = aliases.filter((alias) => tokens.has(alias));
      const conceptToken = `concept:${concept}`;
      const documentEvidence = documents.map((document) => documentConceptEvidence(document, concept, aliases));
      const documentHitCount = documentEvidence.filter((item) => item.score > 0).length;
      const documentScore = documentEvidence.reduce((sum, item) => sum + Math.min(5, item.score), 0);
      const routeBoost = documents.reduce((sum, document) => sum + routeConceptBoost(concept, document.route?.formatId || ""), 0);
      const score = Number((
        directHits.length +
        (expandedTokens.has(conceptToken) ? 1 : 0) +
        (documentScore * 1.15) +
        (documentHitCount * 1.4) +
        routeBoost
      ).toFixed(4));
      return {
        concept,
        score,
        directHits: directHits.slice(0, 8),
        documentHitCount,
        routeBoost: Number(routeBoost.toFixed(4)),
        documentEvidence: documentEvidence
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId))
          .slice(0, 6)
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => (
      right.score - left.score ||
      right.documentHitCount - left.documentHitCount ||
      left.concept.localeCompare(right.concept)
    ));
}

function selectPrimaryConcept(concepts = []) {
  const leadingConcept = concepts[0];
  if (
    !leadingConcept ||
    (
      !MECHANICAL_SEMANTIC_CONCEPTS.has(leadingConcept.concept) &&
      !BROAD_SEMANTIC_CONCEPTS.has(leadingConcept.concept)
    )
  ) {
    return leadingConcept?.concept || "general";
  }
  const domainConcept = concepts.find((item) => (
    DOMAIN_SEMANTIC_CONCEPTS.has(item.concept) &&
    item.documentHitCount >= 2 &&
    item.score >= (leadingConcept.score * 0.52)
  ));
  return domainConcept?.concept || leadingConcept.concept;
}

function topicHierarchyForTokens(tokens = new Set(), expandedTokens = new Set(), keywords = [], documents = []) {
  const concepts = semanticConceptScores(tokens, expandedTokens, { documents });
  const primaryConcept = selectPrimaryConcept(concepts);
  return {
    strategy: "semantic-concept-topic-hierarchy.v1",
    primaryConcept,
    concepts: concepts.slice(0, 5),
    path: [
      "all-sources",
      primaryConcept,
      ...keywords.slice(0, 2)
    ].filter(Boolean)
  };
}

function classificationAssignmentReason({ decision = "", similarity = 0, signal = 0, threshold = LEADER_CLUSTER_THRESHOLD, routeId = "" } = {}) {
  if (decision === "weak-evidence") {
    return `Excluded because signal ${signal} is below garbage threshold ${GARBAGE_SIGNAL_THRESHOLD}.`;
  }
  if (decision === "support-only") {
    return "Kept as a container manifest/support source and excluded from core distillation.";
  }
  if (decision === "new-topic") {
    return `Started a new topic because nearest leader similarity ${similarity} is below threshold ${threshold}.`;
  }
  return `Joined nearest topic because similarity ${similarity} meets threshold ${threshold}${routeId ? ` for route ${routeId}` : ""}.`;
}

function centroidHash(vector = []) {
  if (!vector.length) {
    return "";
  }
  return `sha256:${sha(vector.map((value) => value.toFixed(6)).join(","))}`;
}

function uniqueOrdered(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer = Buffer.alloc(0)) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2) & 0x1f)),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
  };
}

function safeZipEntryName(name = "") {
  const normalized = String(name || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || "entry.bin";
}

function zipBufferFromEntries(entries = []) {
  const localParts = [];
  const centralParts = [];
  const timestamp = dosDateTime();
  let offset = 0;
  for (const entry of entries) {
    const fileName = safeZipEntryName(entry.name);
    const nameBytes = Buffer.from(fileName, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlEscape(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripMarkdownInlineMarkers(value = "") {
  return String(value || "")
    .replace(/[*_~]{1,3}/g, "");
}

function createDocxBuildContext() {
  return { hyperlinks: [] };
}

function markdownLinkTarget(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const angle = trimmed.match(/^<([^>]+)>/);
  if (angle) {
    return angle[1].trim();
  }
  return trimmed.split(/\s+/)[0].replace(/^<|>$/g, "").trim();
}

function addDocxHyperlinkRelationship(context = null, target = "") {
  const href = markdownLinkTarget(target);
  if (!context || !href) {
    return "";
  }
  const id = `rLink${context.hyperlinks.length + 1}`;
  context.hyperlinks.push({ id, target: href });
  return id;
}

function wordRun(text = "", options = {}) {
  const runProps = [
    options.monospace ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/>' : "",
    options.hyperlink ? '<w:color w:val="0563C1"/><w:u w:val="single"/>' : ""
  ].filter(Boolean).join("");
  const runPropsXml = runProps ? `<w:rPr>${runProps}</w:rPr>` : "";
  const runs = String(text || "").split(/\n/).map((line, index) => (
    `${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`
  )).join("");
  return `<w:r>${runPropsXml}${runs}</w:r>`;
}

function wordHyperlinkRun(label = "", target = "", context = null) {
  const id = addDocxHyperlinkRelationship(context, target);
  if (!id) {
    return wordRun(label || target);
  }
  return `<w:hyperlink r:id="${xmlEscape(id)}" w:history="1">${wordRun(label || target, { hyperlink: true })}</w:hyperlink>`;
}

function markdownInlineToWordRuns(value = "", context = null, options = {}) {
  const source = String(value || "");
  const chunks = [];
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let cursor = 0;
  const pushPlain = (text) => {
    if (text) {
      chunks.push(wordRun(stripMarkdownInlineMarkers(text), options));
    }
  };
  for (const match of source.matchAll(pattern)) {
    pushPlain(source.slice(cursor, match.index));
    if (match[2]) {
      const href = markdownLinkTarget(match[2]);
      const label = `Image: ${match[1] || href}`;
      chunks.push(wordHyperlinkRun(label, href, context));
    } else if (match[4]) {
      chunks.push(wordHyperlinkRun(match[3], match[4], context));
    } else {
      chunks.push(wordRun(match[5], { ...options, monospace: true }));
    }
    cursor = (match.index || 0) + match[0].length;
  }
  pushPlain(source.slice(cursor));
  return chunks.join("") || wordRun(stripMarkdownInlineMarkers(source), options);
}

function buildWordDocumentRelationships(context = null) {
  const hyperlinkRelationships = (context?.hyperlinks || []).map((relationship) => (
    `<Relationship Id="${xmlEscape(relationship.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(relationship.target)}" TargetMode="External"/>`
  )).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    hyperlinkRelationships,
    "</Relationships>"
  ].join("");
}

function wordParagraph(text = "", style = "", options = {}) {
  const paragraphProps = [
    style ? `<w:pStyle w:val="${xmlEscape(style)}"/>` : "",
    options.indentTwips ? `<w:ind w:left="${Math.max(0, Number(options.indentTwips) || 0)}"/>` : ""
  ].filter(Boolean).join("");
  const styleXml = paragraphProps ? `<w:pPr>${paragraphProps}</w:pPr>` : "";
  const runs = options.markdownInline
    ? markdownInlineToWordRuns(text, options.context, options)
    : wordRun(text, options);
  return `<w:p>${styleXml}${runs}</w:p>`;
}

function wordTable(rows = [], options = {}) {
  const normalizedRows = rows
    .map((row) => row.map((cell) => (
      options.markdownInline ? String(cell || "").trim() : stripMarkdownInline(cell)
    )).filter((cell, index, cells) => cell || index < cells.length))
    .filter((row) => row.some(Boolean));
  if (!normalizedRows.length) {
    return "";
  }
  const columnCount = Math.max(1, ...normalizedRows.map((row) => row.length));
  const grid = Array.from({ length: columnCount }, () => '<w:gridCol w:w="2400"/>').join("");
  const rowXml = normalizedRows.map((row) => {
    const cells = Array.from({ length: columnCount }, (_, index) => row[index] || "");
    return `<w:tr>${cells.map((cell) => [
      "<w:tc>",
      '<w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>',
      wordParagraph(cell, "", { context: options.context, markdownInline: Boolean(options.markdownInline) }),
      "</w:tc>"
    ].join("")).join("")}</w:tr>`;
  }).join("");
  return [
    "<w:tbl>",
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>',
    `<w:tblGrid>${grid}</w:tblGrid>`,
    rowXml,
    "</w:tbl>"
  ].join("");
}

function markdownToDocxBody(markdown = "", context = null) {
  const blocks = [];
  const lines = String(markdown || "").split(/\r?\n/);
  let inCode = false;
  let codeLines = [];

  const flushCode = () => {
    if (!codeLines.length) {
      return;
    }
    for (const codeLine of codeLines) {
      blocks.push(wordParagraph(codeLine || " ", "CodeBlock", { monospace: true }));
    }
    codeLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] || "";
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }
    if (!line) {
      continue;
    }
    if (line.startsWith("|")) {
      const tableLines = [];
      while (index < lines.length && String(lines[index] || "").trim().startsWith("|")) {
        const tableLine = String(lines[index] || "").trim();
        if (!isMarkdownTableDelimiter(tableLine)) {
          tableLines.push(markdownTableCells(tableLine, { raw: true }));
        }
        index += 1;
      }
      index -= 1;
      const table = wordTable(tableLines, { context, markdownInline: true });
      if (table) {
        blocks.push(table);
      }
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(3, heading[1].length);
      blocks.push(wordParagraph(heading[2], `Heading${level}`, { context, markdownInline: true }));
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      blocks.push(wordParagraph(line.replace(/^[-*]\s+/, "- "), "ListParagraph", { indentTwips: 360, context, markdownInline: true }));
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      blocks.push(wordParagraph(line, "ListParagraph", { indentTwips: 360, context, markdownInline: true }));
      continue;
    }
    blocks.push(wordParagraph(line, "", { context, markdownInline: true }));
  }
  flushCode();
  return blocks.join("");
}

function buildPortableDocxBuffer({ title = "", runId = "", createdAt = "", updatedAt = "", markdown = "" } = {}) {
  const docxContext = createDocxBuildContext();
  const body = markdownToDocxBody(markdown, docxContext) || wordParagraph(title || runId || "External Knowledge Distillation", "Heading1", { context: docxContext, markdownInline: true });
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<w:body>",
    body,
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    "</w:body>",
    "</w:document>"
  ].join("");
  const coreXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${xmlEscape(title || runId)}</dc:title>`,
    "<dc:creator>Pact External Knowledge Distillation</dc:creator>",
    `<dcterms:created xsi:type="dcterms:W3CDTF">${xmlEscape(createdAt || nowIso())}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${xmlEscape(updatedAt || createdAt || nowIso())}</dcterms:modified>`,
    "</cp:coreProperties>"
  ].join("");
  return zipBufferFromEntries([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
    },
    {
      name: "docProps/core.xml",
      data: coreXml
    },
    {
      name: "docProps/app.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pact</Application></Properties>'
    },
    {
      name: "word/document.xml",
      data: documentXml
    },
    {
      name: "word/_rels/document.xml.rels",
      data: buildWordDocumentRelationships(docxContext)
    },
    {
      name: "word/styles.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="list paragraph"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="code block"/><w:pPr><w:spacing w:before="80" w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>'
    }
  ]);
}

function buildPortableDocx(run = {}) {
  return buildPortableDocxBuffer({
    title: run.title || "External Knowledge Distillation",
    runId: run.runId || "",
    createdAt: run.createdAt || "",
    updatedAt: run.updatedAt || "",
    markdown: run.result?.portableDocuments?.[0]?.document?.markdown || ""
  });
}

function humanAgentModeSeparation() {
  return {
    strategy: "human-agent-response-profile-separation.v1",
    humanReadable: {
      responseProfile: "console",
      artifacts: ["portable-markdown", "portable-docx", "console-summary-json", "workspace-package-zip"],
      purpose: "reviewable distillation output without parserTrace or full window payload noise"
    },
    agentReadable: {
      responseProfile: "agent",
      artifacts: ["agent-message-json", "evidence-pack-json", "format-conversion-plan-json", "professional-format-manifest-json"],
      purpose: "machine-readable route, parser, element, window, quality gate, evidence, and convergence payloads"
    },
    apiReadable: {
      responseProfile: "api",
      artifacts: ["result-json", "project-snapshot-json", "reference-gap-report-json"],
      purpose: "complete integration payloads for platform services and audit tooling"
    }
  };
}

function buildConsoleSummary(run = {}) {
  const result = run.result || {};
  const corpusPlan = result.corpusPlan || {};
  const conversionDocuments = new Map((result.formatConversionPlan?.documents || [])
    .map((document) => [document.sourceId, document]));
  return {
    protocolVersion: `${PROTOCOL_VERSION}.console-summary`,
    responseProfile: "console",
    runId: run.runId || "",
    status: run.status || result.status || "unknown",
    title: run.title || "",
    query: run.query || "",
    generatedAt: nowIso(),
    modeSeparation: humanAgentModeSeparation(),
    summary: {
      sourceCount: Number(corpusPlan.sourceCount || 0),
      distillableSourceCount: Number(corpusPlan.distillableSourceCount || 0),
      totalBytes: Number(corpusPlan.totalBytes || 0),
      totalCharacters: Number(corpusPlan.totalCharacters || 0),
      windowCount: Number(corpusPlan.windowCount || 0),
      classificationGroupCount: Number(result.classification?.groupCount || 0),
      coreGroupCount: Number(result.classification?.coreGroupCount || 0),
      garbageGroupCount: Number(result.classification?.garbageGroupCount || 0),
      highConversionRiskCount: Number(result.formatConversionPlan?.summary?.documentWithHighConversionRiskCount || 0),
      mediumConversionRiskCount: Number(result.formatConversionPlan?.summary?.documentWithMediumConversionRiskCount || 0),
      outputArtifactFailedCount: Number(result.formatConversionPlan?.summary?.outputArtifactFailedCount || 0)
    },
    documents: (corpusPlan.documents || []).map((document) => {
      const conversion = conversionDocuments.get(document.sourceId) || {};
      return {
        sourceId: document.sourceId,
        title: document.title,
        fileName: document.fileName,
        routeId: document.route?.formatId || "unknown",
        sourceFormat: conversion.sourceFormat || document.elementPlan?.sourceFormat || document.extension || "",
        pdfSubtype: document.route?.pdfSubtype || document.pdfProfile?.subtype || "",
        byteSize: Number(document.byteSize || 0),
        parseStatus: document.parseStatus || "",
        distillable: Boolean(document.quality?.distillable),
        textCharacters: Number(document.quality?.textCharacters || 0),
        windowCount: Number(document.windowPlan?.windowCount || 0),
        elementCount: Number(document.elementPlan?.elementCount || 0),
        professionalFamily: conversion.professionalFamily || document.formatConversionProfile?.professionalFamily || "",
        parserProfile: conversion.parserProfile || document.formatConversionProfile?.parserProfile || "",
        conversionRiskLevel: conversion.conversionRiskLevel || "",
        qualityGateStatusCounts: conversion.qualityGateStatusCounts || {},
        openability: conversion.openability || {},
        riskFlags: document.route?.riskFlags || [],
        parseWarnings: (document.parseWarnings || []).slice(0, 8)
      };
    }),
    artifactRefs: [
      { artifactId: "portable-markdown", mode: "human", fileName: `${run.runId || "distillation"}.md` },
      { artifactId: "portable-docx", mode: "human", fileName: `${run.runId || "distillation"}.docx` },
      { artifactId: "agent-message-json", mode: "agent", fileName: `${run.runId || "distillation"}.agent.json` },
      { artifactId: "professional-format-manifest-json", mode: "agent", fileName: `${run.runId || "distillation"}.professional-format-manifest.json` },
      { artifactId: "workspace-package-zip", mode: "bundle", fileName: `${run.runId || "distillation"}.workspace-package.zip` }
    ],
    omittedForConsole: ["parserTrace", "windowPlan.windows", "graphEvidence.text_units", "graphEvidence.relationships"]
  };
}

function buildProfessionalFormatManifest(run = {}) {
  const result = run.result || {};
  const corpusDocuments = new Map((result.corpusPlan?.documents || [])
    .map((document) => [document.sourceId, document]));
  const plan = result.formatConversionPlan || {};
  return {
    protocolVersion: `${PROTOCOL_VERSION}.professional-format-manifest`,
    strategy: "professional-format-manifest.v1",
    runId: run.runId || "",
    status: run.status || result.status || "unknown",
    title: run.title || "",
    generatedAt: nowIso(),
    modeSeparation: humanAgentModeSeparation(),
    allSizePolicy: result.corpusPlan?.allSizePolicy || "streaming-windowed",
    formatConversionStrategy: plan.strategy || "office-document-professional-adaptation.v1",
    referencePatterns: [
      "docling.docitem-labels",
      "unstructured.elements",
      "unstructured.chunk_by_title",
      "llama-index.nodes-with-metadata",
      "haystack.explicit-pipeline-components",
      "graphrag.community-reports"
    ],
    summary: plan.summary || {},
    outputArtifactValidation: plan.outputArtifactValidation || null,
    formatMatrix: plan.formatMatrix || [],
    documents: (plan.documents || []).map((document) => {
      const corpusDocument = corpusDocuments.get(document.sourceId) || {};
      return {
        sourceId: document.sourceId,
        title: document.title,
        fileName: document.fileName,
        routeId: document.routeId,
        sourceFormat: document.sourceFormat,
        byteSize: Number(corpusDocument.byteSize || 0),
        pdfProfile: corpusDocument.pdfProfile || null,
        professionalFamily: document.professionalFamily,
        parserProfile: document.parserProfile,
        parserStages: document.parserStages || [],
        structureUnits: document.structureUnits || [],
        adaptationLevel: document.adaptationLevel,
        humanReadableTargets: document.humanReadableTargets || [],
        agentReadableTargets: document.agentReadableTargets || [],
        conversionTargets: document.conversionTargets || [],
        targetFormats: document.targetFormats || [],
        conversionAdapters: document.conversionAdapters || [],
        preserves: document.preserves || [],
        riskControls: document.riskControls || [],
        knownLosses: document.knownLosses || [],
        qualityGates: document.qualityGates || [],
        qualityGateResults: document.qualityGateResults || [],
        qualityGateStatusCounts: document.qualityGateStatusCounts || {},
        conversionRiskLevel: document.conversionRiskLevel || "",
        evidence: document.evidence || {},
        openability: document.openability || {},
        routeRiskFlags: corpusDocument.route?.riskFlags || []
      };
    })
  };
}

function artifactValidationGate(gate = "", passed = false, details = {}) {
  return {
    gate,
    status: passed ? "passed" : "failed",
    severity: passed ? "info" : "error",
    observed: details.observed || {},
    required: details.required || {},
    message: details.message || ""
  };
}

function validateMarkdownArtifactBuffer(buffer = Buffer.alloc(0)) {
  const text = Buffer.from(buffer || []).toString("utf8");
  const gates = [
    artifactValidationGate("utf8-decodable", true, {
      observed: { characters: text.length },
      required: { encoding: "utf8" },
      message: "Markdown artifact decodes as UTF-8."
    }),
    artifactValidationGate("non-empty-document", text.trim().length > 0, {
      observed: { characters: text.trim().length },
      required: { minCharacters: 1 },
      message: text.trim().length > 0 ? "Markdown artifact is non-empty." : "Markdown artifact is empty."
    }),
    artifactValidationGate("no-tika-xhtml-wrapper", !/<html[\s>]|<body[\s>]|http:\/\/www\.w3\.org\/1999\/xhtml/i.test(text), {
      observed: { xhtmlWrapperDetected: /<html[\s>]|<body[\s>]|http:\/\/www\.w3\.org\/1999\/xhtml/i.test(text) },
      required: { cleanMarkdown: true },
      message: "Markdown artifact does not expose Tika XHTML wrapper noise."
    })
  ];
  return {
    artifactId: "portable-markdown",
    format: "markdown",
    strategy: "markdown-utf8-cleanliness-self-check.v1",
    byteSize: buffer.length,
    sha256: shaBuffer(buffer),
    status: gates.every((gate) => gate.status === "passed") ? "passed" : "failed",
    gates
  };
}

function validateOpenXmlDocxBuffer(buffer = Buffer.alloc(0)) {
  const entries = readZipEntries(buffer);
  const entryNames = new Set(entries.map((entry) => entry.name));
  const contentTypes = zipEntryText(entries, "[Content_Types].xml");
  const documentXml = zipEntryText(entries, "word/document.xml");
  const relationshipsXml = zipEntryText(entries, "word/_rels/document.xml.rels");
  const stylesXml = zipEntryText(entries, "word/styles.xml");
  const tableCount = (documentXml.match(/<w:tbl\b/g) || []).length;
  const tableRowCount = (documentXml.match(/<w:tr\b/g) || []).length;
  const tableCellCount = (documentXml.match(/<w:tc\b/g) || []).length;
  const hyperlinkCount = (documentXml.match(/<w:hyperlink\b/g) || []).length;
  const hyperlinkRelationshipCount = (relationshipsXml.match(/relationships\/hyperlink/g) || []).length;
  const gates = [
    artifactValidationGate("zip-readable", entries.length > 0 && !entries.some((entry) => entry.warning), {
      observed: {
        entryCount: entries.length,
        warnings: entries.filter((entry) => entry.warning).map((entry) => entry.warning).slice(0, 8)
      },
      required: { zipEntriesReadable: true },
      message: entries.length > 0 ? "DOCX ZIP entries are readable." : "DOCX ZIP has no readable entries."
    }),
    artifactValidationGate("openxml-required-parts-present", [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "word/document.xml",
      "word/styles.xml"
    ].every((name) => entryNames.has(name)), {
      observed: { entries: Array.from(entryNames).sort() },
      required: { parts: ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "docProps/app.xml", "word/document.xml", "word/styles.xml"] },
      message: "DOCX required OpenXML package parts are present."
    }),
    artifactValidationGate("content-types-wordprocessing-main", /wordprocessingml\.document\.main\+xml/.test(contentTypes), {
      observed: { hasWordprocessingMain: /wordprocessingml\.document\.main\+xml/.test(contentTypes) },
      required: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" },
      message: "DOCX content types declare the WordprocessingML main document."
    }),
    artifactValidationGate("word-document-body-present", /<w:document\b/.test(documentXml) && /<w:body\b/.test(documentXml), {
      observed: { documentCharacters: documentXml.length },
      required: { root: "w:document", body: "w:body" },
      message: "DOCX word/document.xml has a WordprocessingML body."
    }),
    artifactValidationGate("word-document-has-text", /<w:t\b/.test(documentXml), {
      observed: { textNodeCount: (documentXml.match(/<w:t\b/g) || []).length },
      required: { textNodes: true },
      message: "DOCX word/document.xml contains text nodes."
    }),
    artifactValidationGate("word-heading-styles-present", /w:styleId="Heading1"/.test(stylesXml) && /w:pStyle w:val="Heading1"/.test(documentXml), {
      observed: {
        headingStyleDeclared: /w:styleId="Heading1"/.test(stylesXml),
        headingStyleUsed: /w:pStyle w:val="Heading1"/.test(documentXml)
      },
      required: { headingStyles: true },
      message: "DOCX preserves Markdown headings as Word heading styles."
    }),
    artifactValidationGate("word-list-and-code-styles-present", /w:styleId="ListParagraph"/.test(stylesXml) && /w:styleId="CodeBlock"/.test(stylesXml), {
      observed: {
        listStyleDeclared: /w:styleId="ListParagraph"/.test(stylesXml),
        codeStyleDeclared: /w:styleId="CodeBlock"/.test(stylesXml),
        listStyleUsed: /w:pStyle w:val="ListParagraph"/.test(documentXml),
        codeStyleUsed: /w:pStyle w:val="CodeBlock"/.test(documentXml)
      },
      required: { listStyle: true, codeStyle: true },
      message: "DOCX declares professional styles for list and code-block conversion."
    }),
    artifactValidationGate("word-table-elements-well-formed", tableCount === 0 || (tableRowCount > 0 && tableCellCount > 0), {
      observed: { tableCount, tableRowCount, tableCellCount },
      required: { rowsAndCellsWhenTablesExist: true },
      message: tableCount
        ? "DOCX table elements include rows and cells."
        : "No DOCX table was required for this artifact."
    }),
    artifactValidationGate("word-hyperlinks-well-formed", hyperlinkCount === 0 || hyperlinkRelationshipCount >= hyperlinkCount, {
      observed: { hyperlinkCount, hyperlinkRelationshipCount },
      required: { hyperlinkRelationshipForEachHyperlink: true },
      message: hyperlinkCount
        ? "DOCX hyperlinks have matching OpenXML relationships."
        : "No DOCX hyperlinks were required for this artifact."
    })
  ];
  return {
    artifactId: "portable-docx",
    format: "docx",
    strategy: "openxml-package-self-check.v1",
    byteSize: buffer.length,
    sha256: shaBuffer(buffer),
    status: gates.every((gate) => gate.status === "passed") ? "passed" : "failed",
    gates
  };
}

function attachFormatConversionOutputValidation(plan = {}, { title = "", runId = "", createdAt = "", updatedAt = "", markdown = "" } = {}) {
  const markdownBuffer = Buffer.from(String(markdown || ""), "utf8");
  const docxBuffer = buildPortableDocxBuffer({ title, runId, createdAt, updatedAt, markdown });
  const artifactValidations = [
    validateMarkdownArtifactBuffer(markdownBuffer),
    validateOpenXmlDocxBuffer(docxBuffer)
  ];
  const outputArtifactValidation = {
    strategy: "format-conversion-output-artifact-self-check.v1",
    generatedAt: nowIso(),
    artifacts: artifactValidations,
    statusCounts: qualityGateStatusCounts(artifactValidations.map((artifact) => ({ status: artifact.status })))
  };
  return {
    ...plan,
    outputArtifactValidation,
    summary: {
      ...(plan.summary || {}),
      outputArtifactValidationStrategy: outputArtifactValidation.strategy,
      outputArtifactPassedCount: artifactValidations.filter((artifact) => artifact.status === "passed").length,
      outputArtifactFailedCount: artifactValidations.filter((artifact) => artifact.status === "failed").length
    }
  };
}

function runFormatConversionModule({ runId = "", corpusPlan = null, title = "", createdAt = "", updatedAt = "", markdown = "" } = {}) {
  const plan = buildFormatConversionPlan({ runId, corpusPlan });
  const validatedPlan = attachFormatConversionOutputValidation(plan, {
    title,
    runId,
    createdAt,
    updatedAt,
    markdown
  });
  return {
    ...validatedPlan,
    moduleBoundary: FORMAT_CONVERSION_MODULE_BOUNDARY,
    inputArtifacts: ["distillation-workflow-state", "portable-markdown-draft"],
    outputArtifacts: ["portable-markdown", "portable-docx", "console-summary-json", "agent-message-json", "workspace-package-zip"]
  };
}

function jsonArtifactBuffer(value = {}) {
  return Buffer.from(JSON.stringify(value, null, 2), "utf8");
}

function buildWorkspacePackageZip(run = {}) {
  const markdown = Buffer.from(run.result?.portableDocuments?.[0]?.document?.markdown || "", "utf8");
  const docx = buildPortableDocx(run);
  const consoleSummary = jsonArtifactBuffer(buildConsoleSummary(run));
  const professionalFormatManifest = jsonArtifactBuffer(buildProfessionalFormatManifest(run));
  const validationByArtifactId = new Map((run.result?.formatConversionPlan?.outputArtifactValidation?.artifacts || [])
    .map((artifact) => [artifact.artifactId, artifact]));
  const artifactEntries = [
    { artifactId: "portable-markdown", path: "distillation.md", contentType: "text/markdown; charset=utf-8", data: markdown },
    { artifactId: "portable-docx", path: "distillation.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: docx },
    { artifactId: "console-summary-json", path: "console-summary.json", contentType: "application/json; charset=utf-8", data: consoleSummary },
    { artifactId: "agent-message-json", path: "agent-message.json", contentType: "application/json; charset=utf-8", data: jsonArtifactBuffer(run.result?.agentMessage || {}) },
    { artifactId: "result-json", path: "result.json", contentType: "application/json; charset=utf-8", data: jsonArtifactBuffer(run) },
    { artifactId: "project-snapshot-json", path: "project-snapshot.json", contentType: "application/json; charset=utf-8", data: jsonArtifactBuffer(run.result?.incrementalPlan || {}) },
    { artifactId: "evidence-pack-json", path: "evidence-pack.json", contentType: "application/json; charset=utf-8", data: jsonArtifactBuffer(run.result?.graphEvidence || {}) },
    { artifactId: "format-conversion-plan-json", path: "format-conversion-plan.json", contentType: "application/json; charset=utf-8", data: jsonArtifactBuffer(run.result?.formatConversionPlan || {}) },
    { artifactId: "professional-format-manifest-json", path: "professional-format-manifest.json", contentType: "application/json; charset=utf-8", data: professionalFormatManifest },
    { artifactId: "reference-gap-report-json", path: "reference-gap-report.json", contentType: "application/json; charset=utf-8", data: jsonArtifactBuffer(run.result?.referenceGapReport || {}) }
  ];
  const manifest = {
    protocolVersion: `${PROTOCOL_VERSION}.workspace-package`,
    runId: run.runId,
    title: run.title,
    generatedAt: nowIso(),
    responseProfiles: ["human-readable", "agent", "api"],
    artifacts: artifactEntries.map((entry) => ({
      artifactId: entry.artifactId,
      path: entry.path,
      contentType: entry.contentType,
      byteSize: entry.data.length,
      sha256: shaBuffer(entry.data),
      validation: validationByArtifactId.has(entry.artifactId)
        ? {
            strategy: validationByArtifactId.get(entry.artifactId).strategy,
            status: validationByArtifactId.get(entry.artifactId).status,
            gates: (validationByArtifactId.get(entry.artifactId).gates || []).map((gate) => ({
              gate: gate.gate,
              status: gate.status
            }))
          }
        : null
    }))
  };
  return zipBufferFromEntries([
    { name: "manifest.json", data: jsonArtifactBuffer(manifest) },
    ...artifactEntries.map((entry) => ({ name: entry.path, data: entry.data }))
  ]);
}

function windowRecordsForDocument(document = {}) {
  const windows = document.windowPlan?.windows?.length
    ? document.windowPlan.windows
    : [
        {
          windowId: stableId("window", document.sourceId, "synthetic", document.contentHash || document.text || ""),
          index: 0,
          startOffset: 0,
          endOffset: Math.min(String(document.text || "").length, DEFAULT_WINDOW_CHARACTERS),
          excerpt: firstSentence(document.text) || String(document.text || "").slice(0, 220),
          contentHash: document.contentHash || sha(document.text || "")
        }
      ];
  return windows
    .map((window, index) => {
      const excerpt = String(window.excerpt || "").trim();
      const semanticText = `${document.title}\n${excerpt || String(document.text || "").slice(0, 500)}`;
      const tokens = textTokens(semanticText);
      const expandedTokens = expandedSemanticTokens(tokens);
      return {
        sourceId: document.sourceId,
        title: document.title,
        windowId: window.windowId || stableId("window", document.sourceId, String(index), excerpt),
        index: Number(window.index ?? index),
        startOffset: Number(window.startOffset || 0),
        endOffset: Number(window.endOffset || 0),
        contentHash: window.contentHash || sha(excerpt),
        excerpt,
        tokens,
        expandedTokens,
        vector: vectorForTokens(expandedTokens),
        signal: signalStrength({ text: semanticText, tokens })
      };
    })
    .filter((record) => record.excerpt || record.signal > 0);
}

function clusterWindowRecords(records = [], groupId = "") {
  const communities = [];
  for (const record of records) {
    let bestCommunity = null;
    let bestScore = 0;
    for (const community of communities) {
      const score = cosineSimilarity(record.vector, community.centroid);
      if (score > bestScore) {
        bestScore = score;
        bestCommunity = community;
      }
    }
    if (!bestCommunity || bestScore < WINDOW_COMMUNITY_CLUSTER_THRESHOLD) {
      bestCommunity = {
        communityId: stableId("window_community", groupId, String(communities.length), record.windowId),
        centroid: record.vector,
        tokens: new Set(),
        records: [],
        cohesionScores: [],
        signalScores: []
      };
      communities.push(bestCommunity);
    } else {
      bestCommunity.centroid = mergeCentroid(bestCommunity.centroid, record.vector, bestCommunity.records.length);
    }
    bestCommunity.records.push(record);
    bestCommunity.cohesionScores.push(bestCommunity.records.length === 1 ? 1 : bestScore);
    bestCommunity.signalScores.push(record.signal);
    for (const token of record.tokens) {
      bestCommunity.tokens.add(token);
    }
  }
  return communities.map((community, index) => {
    const keywords = topTokens(community.tokens, 5);
    const sourceIds = uniqueOrdered(community.records.map((record) => record.sourceId));
    const windowRefs = community.records.slice(0, 16).map((record) => ({
      sourceId: record.sourceId,
      title: record.title,
      windowId: record.windowId,
      index: record.index,
      startOffset: record.startOffset,
      endOffset: record.endOffset,
      contentHash: record.contentHash,
      excerpt: record.excerpt.slice(0, 220)
    }));
    return {
      communityId: community.communityId,
      level: "window-community",
      title: keywords.slice(0, 3).join(" / ") || `Window Community ${index + 1}`,
      keywords,
      sourceIds,
      sourceCount: sourceIds.length,
      windowCount: community.records.length,
      representedWindowCount: community.records.length,
      windowRefs,
      summary: community.records
        .map((record) => record.excerpt)
        .filter(Boolean)
        .slice(0, 4),
      cohesionScore: Number(
        (
          community.cohesionScores.reduce((sum, score) => sum + score, 0) /
          Math.max(1, community.cohesionScores.length)
        ).toFixed(4)
      ),
      signalScore: Number(
        (
          community.signalScores.reduce((sum, score) => sum + score, 0) /
          Math.max(1, community.signalScores.length)
        ).toFixed(4)
      )
    };
  });
}

function buildDistillationUnit(group = {}, windowCommunities = []) {
  const sourceIds = group.documents.map((document) => document.sourceId);
  const windowRefs = windowCommunities.flatMap((community) => (
    community.windowRefs.map((ref) => ({
      ...ref,
      communityId: community.communityId
    }))
  )).slice(0, 24);
  return {
    unitId: stableId("distillation_unit", group.groupId, sourceIds.join(",")),
    mode: "topic-isolated",
    sourceIds,
    sourceCount: sourceIds.length,
    topicPath: group.topicHierarchy?.path || [],
    windowCommunityIds: windowCommunities.map((community) => community.communityId),
    windowCount: windowCommunities.reduce((sum, community) => sum + community.windowCount, 0),
    windowRefs,
    summary: group.documents.map((document) => firstSentence(document.text)).filter(Boolean).slice(0, 5),
    quality: {
      cohesionScore: group.cohesionScore,
      separationScore: group.separationScore ?? 1,
      lowCoupling: (group.separationScore ?? 1) >= CLASSIFICATION_SEPARATION_THRESHOLD,
      highCohesion: group.cohesionScore >= LEADER_CLUSTER_THRESHOLD
    }
  };
}

function addGroupSeparation(topicGroups = []) {
  const coreGroups = topicGroups.filter((group) => !group.excludedFromCore);
  for (const group of coreGroups) {
    const links = [];
    let maxSimilarity = 0;
    for (const other of coreGroups) {
      if (other.groupId === group.groupId) {
        continue;
      }
      const similarity = Number(cosineSimilarity(group._centroid || [], other._centroid || []).toFixed(4));
      maxSimilarity = Math.max(maxSimilarity, similarity);
      if (similarity >= CROSS_TOPIC_LINK_THRESHOLD) {
        links.push({
          groupId: other.groupId,
          label: other.label,
          similarity
        });
      }
    }
    group.interGroupMaxSimilarity = Number(maxSimilarity.toFixed(4));
    group.separationScore = Number((1 - maxSimilarity).toFixed(4));
    group.boundary = group.separationScore >= CLASSIFICATION_SEPARATION_THRESHOLD ? "isolated" : "overlap-review";
    group.crossTopicLinks = links.sort((left, right) => right.similarity - left.similarity).slice(0, 6);
    group.distillationUnit.quality.separationScore = group.separationScore;
    group.distillationUnit.quality.lowCoupling = group.separationScore >= CLASSIFICATION_SEPARATION_THRESHOLD;
  }
  return topicGroups;
}

function publicClassificationGroup(group = {}) {
  const {
    documents: _documents,
    tokens: _tokens,
    expandedTokens: _expandedTokens,
    centroid: _centroid,
    _centroid: __centroid,
    ...publicGroup
  } = group;
  return publicGroup;
}

function classifyDocuments(documents = []) {
  const groups = [];
  const garbageDocuments = [];
  const supportDocuments = [];
  const assignmentBySourceId = new Map();
  const containerParentIds = new Set(
    documents
      .filter((document) => documents.some((child) => child.parentSourceId === document.sourceId))
      .map((document) => document.sourceId)
  );
  for (const [index, document] of documents.entries()) {
    if (containerParentIds.has(document.sourceId) && ["archive", "directory"].includes(document.route?.formatId)) {
      assignmentBySourceId.set(document.sourceId, {
        decision: "support-only",
        similarity: 0,
        threshold: 0,
        signalScore: 0,
        routeId: document.route?.formatId || "archive",
        reason: classificationAssignmentReason({ decision: "support-only" })
      });
      supportDocuments.push(document);
      continue;
    }
    const windowPreview = (document.windowPlan?.windows || [])
      .slice(0, 8)
      .map((window) => window.excerpt)
      .join("\n");
    const tokens = textTokens(`${document.title}\n${document.text.slice(0, 12_000)}\n${windowPreview}`);
    const expandedTokens = expandedSemanticTokens(tokens);
    const vector = vectorForTokens(expandedTokens);
    const signal = signalStrength({ text: document.text, tokens });
    if (signal < GARBAGE_SIGNAL_THRESHOLD) {
      assignmentBySourceId.set(document.sourceId, {
        decision: "weak-evidence",
        similarity: 0,
        threshold: GARBAGE_SIGNAL_THRESHOLD,
        signalScore: signal,
        routeId: document.route?.formatId || "unknown",
        tokenCount: tokens.size,
        reason: classificationAssignmentReason({ decision: "weak-evidence", signal })
      });
      garbageDocuments.push({ document, tokens, expandedTokens, vector, signal });
      continue;
    }
    let bestGroup = null;
    let bestScore = 0;
    for (const group of groups) {
      const score = cosineSimilarity(vector, group.centroid);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }
    if (!bestGroup || bestScore < LEADER_CLUSTER_THRESHOLD) {
      bestGroup = {
        groupId: stableId("topic_group", document.title, index),
        label: "",
        tokens: new Set(),
        expandedTokens: new Set(),
        centroid: vector,
        documents: [],
        cohesionScores: [],
        signalScores: []
      };
      groups.push(bestGroup);
      assignmentBySourceId.set(document.sourceId, {
        decision: "new-topic",
        similarity: Number(bestScore.toFixed(4)),
        threshold: LEADER_CLUSTER_THRESHOLD,
        signalScore: signal,
        routeId: document.route?.formatId || "unknown",
        tokenCount: tokens.size,
        reason: classificationAssignmentReason({
          decision: "new-topic",
          similarity: Number(bestScore.toFixed(4)),
          signal,
          threshold: LEADER_CLUSTER_THRESHOLD,
          routeId: document.route?.formatId || "unknown"
        })
      });
    } else {
      bestGroup.centroid = mergeCentroid(bestGroup.centroid, vector, bestGroup.documents.length);
      assignmentBySourceId.set(document.sourceId, {
        decision: "nearest-leader",
        similarity: Number(bestScore.toFixed(4)),
        threshold: LEADER_CLUSTER_THRESHOLD,
        signalScore: signal,
        routeId: document.route?.formatId || "unknown",
        tokenCount: tokens.size,
        reason: classificationAssignmentReason({
          decision: "nearest-leader",
          similarity: Number(bestScore.toFixed(4)),
          signal,
          threshold: LEADER_CLUSTER_THRESHOLD,
          routeId: document.route?.formatId || "unknown"
        })
      });
    }
    bestGroup.documents.push(document);
    bestGroup.cohesionScores.push(bestGroup.documents.length === 1 ? 1 : bestScore);
    bestGroup.signalScores.push(signal);
    for (const token of tokens) {
      bestGroup.tokens.add(token);
    }
    for (const token of expandedTokens) {
      bestGroup.expandedTokens.add(token);
    }
  }
  mergeLeaderGroupsBySemanticConcept(groups);
  const topicGroups = groups.map((group, index) => {
    const keywords = topTokens(group.tokens, 5);
    const topicHierarchy = topicHierarchyForTokens(group.tokens, group.expandedTokens, keywords, group.documents);
    const topicGroup = {
      groupId: group.groupId,
      kind: "topic",
      excludedFromCore: false,
      label: keywords.slice(0, 3).join(" / ") || `Topic ${index + 1}`,
      keywords,
      topicHierarchy,
      sourceCount: group.documents.length,
      sourceIds: group.documents.map((document) => document.sourceId),
      assignmentRationale: {
        strategy: "leader-clustering-semantic-concept-rationale.v1",
        leaderThreshold: LEADER_CLUSTER_THRESHOLD,
        garbageSignalThreshold: GARBAGE_SIGNAL_THRESHOLD,
        documents: group.documents.map((document) => {
          const assignment = assignmentBySourceId.get(document.sourceId) || {};
          return {
            sourceId: document.sourceId,
            title: document.title,
            routeId: document.route?.formatId || "unknown",
            decision: assignment.decision || "unknown",
            similarity: assignment.similarity ?? 0,
            threshold: assignment.threshold ?? LEADER_CLUSTER_THRESHOLD,
            signalScore: assignment.signalScore ?? 0,
            tokenCount: assignment.tokenCount ?? 0,
            reason: assignment.reason || ""
          };
        })
      },
      embedding: {
        dimensions: EMBEDDING_DIMENSIONS,
        centroidHash: centroidHash(group.centroid),
        signalScore: Number(
          (
            group.signalScores.reduce((sum, score) => sum + score, 0) /
            Math.max(1, group.signalScores.length)
          ).toFixed(4)
        )
      },
      cohesionScore: Number(
        (
          group.cohesionScores.reduce((sum, score) => sum + score, 0) /
          Math.max(1, group.cohesionScores.length)
        ).toFixed(4)
      ),
      _centroid: group.centroid,
      documents: group.documents
    };
    const windowCommunities = clusterWindowRecords(
      group.documents.flatMap((document) => windowRecordsForDocument(document)),
      topicGroup.groupId
    );
    topicGroup.windowCommunities = windowCommunities;
    topicGroup.communityCount = windowCommunities.length;
    topicGroup.distillationUnit = buildDistillationUnit(topicGroup, windowCommunities);
    return topicGroup;
  });
  addGroupSeparation(topicGroups);
  const supportGroups = supportDocuments.length
    ? [
        {
          groupId: stableId("support_group", supportDocuments.map((document) => document.sourceId).join(",")),
          kind: "container-manifest",
          excludedFromCore: true,
          label: "Container manifests",
          keywords: ["container", "manifest"],
          topicHierarchy: {
            strategy: "semantic-concept-topic-hierarchy.v1",
            primaryConcept: "support",
            concepts: [],
            path: ["all-sources", "support", "container-manifest"]
          },
          sourceCount: supportDocuments.length,
          sourceIds: supportDocuments.map((document) => document.sourceId),
          assignmentRationale: {
            strategy: "leader-clustering-semantic-concept-rationale.v1",
            leaderThreshold: LEADER_CLUSTER_THRESHOLD,
            garbageSignalThreshold: GARBAGE_SIGNAL_THRESHOLD,
            documents: supportDocuments.map((document) => {
              const assignment = assignmentBySourceId.get(document.sourceId) || {};
              return {
                sourceId: document.sourceId,
                title: document.title,
                routeId: document.route?.formatId || "archive",
                decision: assignment.decision || "support-only",
                similarity: assignment.similarity ?? 0,
                threshold: assignment.threshold ?? 0,
                signalScore: assignment.signalScore ?? 0,
                tokenCount: assignment.tokenCount ?? 0,
                reason: assignment.reason || classificationAssignmentReason({ decision: "support-only" })
              };
            })
          },
          embedding: {
            dimensions: EMBEDDING_DIMENSIONS,
            centroidHash: "",
            signalScore: 0
          },
          cohesionScore: 0,
          separationScore: null,
          boundary: "support-only",
          crossTopicLinks: [],
          communityCount: 0,
          windowCommunities: [],
          distillationUnit: null,
          documents: supportDocuments
        }
      ]
    : [];
  if (!garbageDocuments.length) {
    return [...topicGroups, ...supportGroups];
  }
  const garbageTokens = new Set();
  for (const item of garbageDocuments) {
    for (const token of item.tokens) {
      garbageTokens.add(token);
    }
  }
  return [
    ...topicGroups,
    ...supportGroups,
    {
      groupId: stableId("garbage_group", garbageDocuments.map((item) => item.document.sourceId).join(",")),
      kind: "garbage",
      excludedFromCore: true,
      label: "Weak evidence / noise",
      keywords: topTokens(garbageTokens, 5),
      topicHierarchy: {
        strategy: "semantic-concept-topic-hierarchy.v1",
        primaryConcept: "garbage",
        concepts: [],
        path: ["all-sources", "excluded", "weak-evidence"]
      },
      sourceCount: garbageDocuments.length,
      sourceIds: garbageDocuments.map((item) => item.document.sourceId),
      assignmentRationale: {
        strategy: "leader-clustering-semantic-concept-rationale.v1",
        leaderThreshold: LEADER_CLUSTER_THRESHOLD,
        garbageSignalThreshold: GARBAGE_SIGNAL_THRESHOLD,
        documents: garbageDocuments.map((item) => {
          const assignment = assignmentBySourceId.get(item.document.sourceId) || {};
          return {
            sourceId: item.document.sourceId,
            title: item.document.title,
            routeId: item.document.route?.formatId || "unknown",
            decision: assignment.decision || "weak-evidence",
            signalScore: assignment.signalScore ?? item.signal,
            threshold: assignment.threshold ?? GARBAGE_SIGNAL_THRESHOLD,
            tokenCount: assignment.tokenCount ?? item.tokens.size,
            reason: assignment.reason || classificationAssignmentReason({ decision: "weak-evidence", signal: item.signal })
          };
        })
      },
      exclusionReasons: garbageDocuments.map((item) => ({
        sourceId: item.document.sourceId,
        code: "WEAK_EVIDENCE_SIGNAL",
        signalScore: item.signal,
        threshold: GARBAGE_SIGNAL_THRESHOLD,
        reason: classificationAssignmentReason({ decision: "weak-evidence", signal: item.signal })
      })),
      embedding: {
        dimensions: EMBEDDING_DIMENSIONS,
        centroidHash: "",
        signalScore: Number(
          (
            garbageDocuments.reduce((sum, item) => sum + item.signal, 0) /
            Math.max(1, garbageDocuments.length)
          ).toFixed(4)
        )
      },
      cohesionScore: 0,
      documents: garbageDocuments.map((item) => item.document)
    }
  ];
}

function firstSentence(text = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const match = normalized.match(/^.{1,220}?(?:[!?。！？]|\.(?=\s|$)|$)/u);
  return (match?.[0] || normalized.slice(0, 220)).trim();
}

function dateFieldConfidence(field = "") {
  const normalized = String(field || "").toLowerCase().replace(/[_-]+/g, " ");
  if (/(payment|settlement|invoice|due|report|event|document|created|modified|issued|period|date|time|timestamp)/i.test(normalized)) {
    return 0.92;
  }
  if (/(日期|时间|付款|结算|报告|创建|修改|发票|期间)/u.test(normalized)) {
    return 0.92;
  }
  return 0;
}

function isoDateFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return "";
  }
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return "";
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function isoDateFromExcelSerial(value = "") {
  const serial = Number(String(value || "").trim());
  if (!Number.isFinite(serial) || serial < 25_000 || serial > 80_000) {
    return "";
  }
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function normalizeDateValue(value = "", allowSerial = false) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  let match = text.match(/\b(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?\b/u);
  if (match) {
    return isoDateFromParts(match[1], match[2], match[3]);
  }
  match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/u);
  if (match) {
    return isoDateFromParts(match[3], match[1], match[2]);
  }
  return allowSerial ? isoDateFromExcelSerial(text) : "";
}

function extractTimeSignals(text = "") {
  const signals = [];
  const seen = new Set();
  const push = (date = "", field = "", confidence = 0.55, evidence = "") => {
    if (!date) {
      return;
    }
    const key = `${date}|${field}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    signals.push({
      date,
      field: String(field || "").trim(),
      confidence: Number(confidence.toFixed(2)),
      evidence: firstSentence(evidence || date).slice(0, 160)
    });
  };
  const value = String(text || "");
  for (const match of value.matchAll(/([A-Za-z0-9_ /\-.\u4e00-\u9fff]{2,56})\s*[:=]\s*([^;\n]+)/gu)) {
    const field = match[1].replace(/\s+/g, " ").trim();
    const confidence = dateFieldConfidence(field);
    if (!confidence) {
      continue;
    }
    const date = normalizeDateValue(match[2], true);
    push(date, field, confidence, match[0]);
  }
  for (const match of value.matchAll(/\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/gu)) {
    push(normalizeDateValue(match[1], false), "text", 0.55, match[0]);
  }
  return signals.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.date.localeCompare(right.date);
  });
}

function inferTimeMetadataFromText(text = "") {
  const signals = extractTimeSignals(text);
  if (!signals.length) {
    return {
      timeRange: null,
      timeConfidence: 0,
      timeSignals: []
    };
  }
  const dates = signals.map((signal) => signal.date).sort();
  return {
    timeRange: {
      from: dates[0],
      to: dates[dates.length - 1],
      source: "content-derived",
      field: signals[0].field,
      confidence: signals[0].confidence
    },
    timeConfidence: signals[0].confidence,
    timeSignals: signals.slice(0, 8)
  };
}

function normalizeTimeFilter(input = {}) {
  const source = input.timeFilter && typeof input.timeFilter === "object" ? input.timeFilter : {};
  const from = normalizeDateValue(source.from || source.start || input.timeFrom || input.from || "", false);
  const to = normalizeDateValue(source.to || source.end || input.timeTo || input.to || "", false);
  const rawField = String(source.timeField || input.timeField || "eventTime").trim();
  const timeField = ["eventTime", "documentTime", "any"].includes(rawField) ? rawField : "eventTime";
  const rawConfidence = Number(source.confidenceMin ?? input.confidenceMin ?? 0);
  const excludeWeakEvidence = Boolean(source.excludeWeakEvidence ?? input.excludeWeakEvidence ?? false);
  const confidenceMin = Number(Math.max(0, Math.min(1, Number.isFinite(rawConfidence) ? rawConfidence : 0)).toFixed(2));
  const includeUnknownTime = Boolean(source.includeUnknownTime ?? input.includeUnknownTime ?? false);
  const active = Boolean(from || to || confidenceMin > 0 || excludeWeakEvidence || source.timeField || input.timeField);
  return {
    active,
    from,
    to,
    timeField,
    confidenceMin,
    excludeWeakEvidence,
    includeUnknownTime,
    mode: "document-window-time-filter.v1"
  };
}

function dateRangeMatches(range = null, filter = {}) {
  if (!range) {
    return false;
  }
  const from = normalizeDateValue(range.from || range.date || "", false);
  const to = normalizeDateValue(range.to || range.from || range.date || "", false);
  if (!from && !to) {
    return false;
  }
  const start = from || to;
  const end = to || from;
  if (filter.from && end < filter.from) {
    return false;
  }
  if (filter.to && start > filter.to) {
    return false;
  }
  return true;
}

function signalPassesConfidence(signal = {}, filter = {}) {
  const minimum = filter.confidenceMin || (filter.excludeWeakEvidence ? 0.75 : 0);
  return Number(signal.confidence || 0) >= minimum;
}

function documentTimeRangeForFilter(document = {}, filter = {}) {
  if (filter.timeField === "documentTime") {
    const date = normalizeDateValue(document.documentTime || document.capturedAt || "", false);
    return date ? { from: date, to: date, source: "documentTime", confidence: 1 } : null;
  }
  if (filter.timeField === "any") {
    const eventRange = document.timeRange || (document.eventTime ? { from: document.eventTime, to: document.eventTime, source: "eventTime", confidence: 1 } : null);
    if (eventRange) {
      return eventRange;
    }
    const date = normalizeDateValue(document.documentTime || document.capturedAt || "", false);
    return date ? { from: date, to: date, source: "documentTime", confidence: 1 } : null;
  }
  return document.timeRange || (document.eventTime ? { from: document.eventTime, to: document.eventTime, source: "eventTime", confidence: 1 } : null);
}

function documentMatchesTimeFilter(document = {}, filter = {}) {
  if (!filter.active) {
    return true;
  }
  const range = documentTimeRangeForFilter(document, filter);
  if (!range) {
    return filter.includeUnknownTime && !filter.excludeWeakEvidence;
  }
  if (!dateRangeMatches(range, filter)) {
    return false;
  }
  return signalPassesConfidence({ confidence: range.confidence ?? document.timeConfidence ?? 0 }, filter);
}

function windowMatchesTimeFilter(window = {}, filter = {}) {
  if (!filter.active) {
    return true;
  }
  if (!window.timeRange) {
    return false;
  }
  if (!dateRangeMatches(window.timeRange, filter)) {
    return false;
  }
  return signalPassesConfidence({ confidence: window.timeConfidence ?? window.timeRange?.confidence ?? 0 }, filter);
}

function applyTimeFilterToDocuments(documents = [], filter = {}, windowOptions = {}) {
  if (!filter.active) {
    return {
      documents,
      summary: {
        ...filter,
        matchedSourceIds: documents.map((document) => document.sourceId),
        filteredOutSourceIds: [],
        matchedSourceCount: documents.length,
        filteredOutSourceCount: 0
      }
    };
  }
  const matched = [];
  const filteredOut = [];
  for (const document of documents) {
    const baseWindowPlan = document.streamingWindowPlan || buildWindowPlan(document, windowOptions);
    const hasTimedWindows = (baseWindowPlan.windows || []).some((window) => window.timeRange);
    const matchingWindows = hasTimedWindows
      ? (baseWindowPlan.windows || []).filter((window) => windowMatchesTimeFilter(window, filter))
      : [];
    const documentMatches = documentMatchesTimeFilter(document, filter);
    if (!documentMatches && !matchingWindows.length) {
      filteredOut.push(document.sourceId);
      continue;
    }
    const windowPlan = matchingWindows.length
      ? {
          ...baseWindowPlan,
          windows: matchingWindows.map((window, index) => ({ ...window, index })),
          windowCount: matchingWindows.length,
          filteredFromWindowCount: baseWindowPlan.windowCount || baseWindowPlan.windows?.length || matchingWindows.length
        }
      : baseWindowPlan;
    matched.push({
      ...document,
      streamingWindowPlan: windowPlan,
      timeFilterMatched: true
    });
  }
  return {
    documents: matched,
    summary: {
      ...filter,
      matchedSourceIds: matched.map((document) => document.sourceId),
      filteredOutSourceIds: filteredOut,
      matchedSourceCount: matched.length,
      filteredOutSourceCount: filteredOut.length
    }
  };
}

function evidenceKey(index) {
  return `E${index + 1}`;
}

function evidenceRefsForDocuments(allDocuments = [], sourceDocuments = []) {
  return sourceDocuments.map((document) => {
    const index = allDocuments.findIndex((item) => item.sourceId === document.sourceId);
    return evidenceKey(Math.max(0, index));
  });
}

function claimPolarity(text = "") {
  const normalized = String(text || "").toLowerCase();
  if (/(?:\bnot\b|\bnever\b|\bno\b|\bwithout\b|\bcannot\b|\bcan't\b|\bunsupported\b|\bfalse\b|\bdenied\b|\bprohibit|禁止|不支持|不能|无法|未|没有|非)/u.test(normalized)) {
    return -1;
  }
  if (/(?:\bmust\b|\bshould\b|\bcan\b|\bsupports?\b|\bguaranteed\b|\brequired\b|\bconfirmed\b|\ballowed\b|\bpermitted\b|\benabled\b|必须|应该|支持|确认|允许|保证)/u.test(normalized)) {
    return 1;
  }
  return 0;
}

function evidenceCandidatesForClaim(claimText = "", documents = [], allDocuments = documents, options = {}) {
  const claimTokens = expandedSemanticTokens(textTokens(claimText));
  const claimVector = vectorForText(claimText);
  const polarity = claimPolarity(claimText);
  const candidates = [];
  for (const document of documents) {
    const index = Math.max(0, allDocuments.findIndex((item) => item.sourceId === document.sourceId));
    const evidenceVector = vectorForText(`${document.title}\n${document.text.slice(0, 12_000)}`);
    const semanticScore = cosineSimilarity(claimVector, evidenceVector);
    const evidenceTokens = expandedSemanticTokens(textTokens(`${document.title}\n${document.text.slice(0, 12_000)}`));
    let overlap = 0;
    for (const token of claimTokens) {
      if (evidenceTokens.has(token)) {
        overlap += 1;
      }
    }
    const lexicalScore = overlap / Math.max(1, claimTokens.size);
    const evidencePolarity = claimPolarity(document.text);
    const polarityMismatch = polarity !== 0 && evidencePolarity !== 0 && polarity !== evidencePolarity && lexicalScore >= 0.2;
    const rawScore = Math.max(semanticScore, lexicalScore);
    const relation = polarityMismatch ? "conflict" : "support";
    const supportScore = Number((relation === "support" ? rawScore : Math.min(semanticScore, lexicalScore) * 0.5).toFixed(4));
    const conflictScore = Number((relation === "conflict" ? rawScore : 0).toFixed(4));
    candidates.push({
      evidenceRef: evidenceKey(index),
      sourceId: document.sourceId,
      title: document.title,
      groupId: document.groupId || options.groupId || "",
      groupLabel: document.groupLabel || options.groupLabel || "",
      excerpt: firstSentence(document.text),
      semanticScore: Number(semanticScore.toFixed(4)),
      lexicalScore: Number(lexicalScore.toFixed(4)),
      supportScore,
      conflictScore,
      relation
    });
  }
  return candidates.sort((left, right) => {
    const leftScore = Math.max(left.supportScore, left.conflictScore);
    const rightScore = Math.max(right.supportScore, right.conflictScore);
    return rightScore - leftScore || left.sourceId.localeCompare(right.sourceId);
  });
}

function annotatedGroupDocuments(group = {}) {
  return (group.documents || []).map((document) => ({
    ...document,
    groupId: group.groupId,
    groupLabel: group.label
  }));
}

function statusForEvidence(topSupport = null, topConflict = null) {
  if (topConflict && topConflict.conflictScore >= GROUNDING_CONFLICT_THRESHOLD && (!topSupport || topConflict.conflictScore > topSupport.supportScore)) {
    return "contradicted";
  }
  if (topSupport && topSupport.supportScore >= GROUNDING_SUPPORT_THRESHOLD) {
    return "entailed";
  }
  return "neutral";
}

function buildClaimRecord({ claimId, groupId = "", source = "", text = "", supportCandidates = [], conflictCandidates = [] } = {}) {
  const topEvidence = supportCandidates
    .filter((candidate) => candidate.relation === "support")
    .filter((candidate) => candidate.supportScore >= GROUNDING_SUPPORT_THRESHOLD)
    .slice(0, 3);
  const conflictEvidence = conflictCandidates
    .filter((candidate) => candidate.relation === "conflict")
    .filter((candidate) => candidate.conflictScore >= GROUNDING_CONFLICT_THRESHOLD)
    .slice(0, 3);
  const topSupport = topEvidence[0] || supportCandidates.find((candidate) => candidate.relation === "support") || null;
  const topConflict = conflictEvidence[0] || null;
  const status = statusForEvidence(topSupport, topConflict);
  return {
    claimId,
    groupId,
    source,
    text,
    status,
    supportScore: topSupport?.supportScore || 0,
    conflictScore: topConflict?.conflictScore || 0,
    evidenceRefs: status === "entailed" ? topEvidence.map((candidate) => candidate.evidenceRef) : [],
    conflictRefs: conflictEvidence.map((candidate) => candidate.evidenceRef),
    topEvidence,
    conflictEvidence
  };
}

function candidatePromotionGateForGroup(group = {}, grounding = {}) {
  const groupClaims = (grounding.claims || []).filter((claim) => claim.groupId === group.groupId);
  const entailed = groupClaims.filter((claim) => claim.status === "entailed").length;
  const neutral = groupClaims.filter((claim) => claim.status === "neutral").length;
  const contradicted = groupClaims.filter((claim) => claim.status === "contradicted").length;
  const promoted = entailed > 0 && contradicted === 0;
  return {
    promoted,
    mode: "claim-grounded-promotion",
    requiredEntailedClaims: 1,
    entailed,
    neutral,
    contradicted,
    rejectedReason: promoted ? "" : contradicted > 0 ? "contradicted-claim" : "no-entailed-claim"
  };
}

function buildGroundingReport({ documents = [], classification = {}, requestedClaims = [] } = {}) {
  const claims = [];
  const coreGroups = (classification.groups || []).filter((group) => !group.excludedFromCore);
  const annotatedAllDocuments = coreGroups.flatMap((group) => annotatedGroupDocuments(group));
  for (const group of classification.groups || []) {
    if (group.excludedFromCore) {
      continue;
    }
    const groupDocuments = annotatedGroupDocuments(group);
    const outsideDocuments = annotatedAllDocuments.filter((document) => document.groupId !== group.groupId);
    for (const document of group.documents.slice(0, 3)) {
      const claimText = firstSentence(document.text);
      if (!claimText) {
        continue;
      }
      claims.push(buildClaimRecord({
        claimId: stableId("claim", group.groupId, document.sourceId, claimText),
        groupId: group.groupId,
        source: "generated-summary",
        text: claimText,
        supportCandidates: evidenceCandidatesForClaim(claimText, groupDocuments, documents, { groupId: group.groupId, groupLabel: group.label }),
        conflictCandidates: evidenceCandidatesForClaim(claimText, outsideDocuments, documents)
      }));
    }
  }
  for (const [index, claim] of requestedClaims.entries()) {
    const claimText = typeof claim === "string" ? claim : String(claim?.text || claim?.claim || "");
    if (!claimText.trim()) {
      continue;
    }
    const supportCandidates = evidenceCandidatesForClaim(claimText, annotatedAllDocuments.length ? annotatedAllDocuments : documents, documents);
    claims.push(buildClaimRecord({
      claimId: stableId("requested_claim", String(index), claimText),
      groupId: supportCandidates.find((candidate) => candidate.relation === "support" && candidate.supportScore >= GROUNDING_SUPPORT_THRESHOLD)?.groupId || "",
      source: "requested-claim",
      text: claimText,
      supportCandidates,
      conflictCandidates: supportCandidates
    }));
  }
  const supported = claims.filter((claim) => claim.status === "entailed").length;
  const contradicted = claims.filter((claim) => claim.status === "contradicted").length;
  const neutral = claims.filter((claim) => claim.status === "neutral").length;
  const groundingScore = claims.length ? supported / claims.length : 0;
  const promotionGates = Object.fromEntries(coreGroups.map((group) => [
    group.groupId,
    candidatePromotionGateForGroup(group, { claims })
  ]));
  return {
    strategy: GROUNDING_STRATEGY,
    supportThreshold: GROUNDING_SUPPORT_THRESHOLD,
    conflictThreshold: GROUNDING_CONFLICT_THRESHOLD,
    claimCount: claims.length,
    supported,
    neutral,
    contradicted,
    groundingScore: Number(groundingScore.toFixed(4)),
    passed: claims.length > 0 && contradicted === 0 && neutral === 0,
    promotionGates,
    claims
  };
}

function documentConvergencePath(document = {}) {
  const explicitPath = String(document.archivePath || document.fileName || document.title || document.sourceId || "").trim();
  if (explicitPath && explicitPath !== document.title) {
    return explicitPath.replace(/\\/g, "/").replace(/^\/+/, "");
  }
  const sourceId = String(document.sourceId || "");
  if (sourceId.includes("!")) {
    return sourceId.split("!").slice(1).join("!").replace(/\\/g, "/").replace(/^\/+/, "");
  }
  return explicitPath || sourceId || "root";
}

function projectDomainKeyForDocument(document = {}) {
  const pathName = documentConvergencePath(document);
  const parts = pathName
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts[0];
  }
  if (document.parentSourceId) {
    return "root";
  }
  const routeId = document.route?.formatId || document.routeId || "unknown";
  if (routeId === "archive") {
    return "package";
  }
  return "root";
}

function projectDomainId(domainKey = "") {
  return stableId("project_domain", domainKey || "root");
}

function projectDomainMetadata(document = {}) {
  const domainKey = projectDomainKeyForDocument(document);
  const pathName = documentConvergencePath(document);
  return {
    projectDomain: domainKey,
    projectDomainId: projectDomainId(domainKey),
    projectPath: pathName
  };
}

function buildProjectDomainReports({ corpusPlan = {}, classification = {} } = {}) {
  const documents = Array.isArray(corpusPlan.documents) ? corpusPlan.documents : [];
  const groupBySourceId = new Map();
  for (const group of classification.groups || []) {
    for (const sourceId of group.sourceIds || []) {
      if (!groupBySourceId.has(sourceId)) {
        groupBySourceId.set(sourceId, []);
      }
      groupBySourceId.get(sourceId).push(group);
    }
  }
  const domains = new Map();
  for (const document of documents) {
    const domain = projectDomainMetadata(document);
    if (!domains.has(domain.projectDomain)) {
      domains.set(domain.projectDomain, {
        domainId: domain.projectDomainId,
        domainKey: domain.projectDomain,
        label: domain.projectDomain === "root" ? "root" : `${domain.projectDomain}/`,
        sourceIds: [],
        parentSourceIds: new Set(),
        routeIds: new Set(),
        groupIds: new Set(),
        communityIds: new Set(),
        topicLabels: new Set(),
        paths: [],
        windowCount: 0,
        elementCount: 0,
        byteSize: 0,
        textCharacters: 0,
        distillableSourceCount: 0
      });
    }
    const report = domains.get(domain.projectDomain);
    report.sourceIds.push(document.sourceId);
    if (document.parentSourceId) {
      report.parentSourceIds.add(document.parentSourceId);
    }
    report.routeIds.add(document.route?.formatId || document.routeId || "unknown");
    report.paths.push(domain.projectPath);
    report.windowCount += Number(document.windowPlan?.windowCount || 0);
    report.elementCount += Number(document.elementPlan?.elementCount || 0);
    report.byteSize += Number(document.byteSize || 0);
    report.textCharacters += Number(document.quality?.textCharacters || 0);
    if (document.quality?.distillable || Number(document.windowPlan?.windowCount || 0) > 0) {
      report.distillableSourceCount += 1;
    }
    for (const group of groupBySourceId.get(document.sourceId) || []) {
      report.groupIds.add(group.groupId);
      report.topicLabels.add(group.label);
      for (const community of group.windowCommunities || []) {
        if ((community.sourceIds || []).includes(document.sourceId)) {
          report.communityIds.add(community.communityId);
        }
      }
    }
  }
  return Array.from(domains.values())
    .map((report) => ({
      domainId: report.domainId,
      domainKey: report.domainKey,
      label: report.label,
      sourceCount: report.sourceIds.length,
      distillableSourceCount: report.distillableSourceCount,
      windowCount: report.windowCount,
      elementCount: report.elementCount,
      byteSize: report.byteSize,
      textCharacters: report.textCharacters,
      routeIds: Array.from(report.routeIds).sort(),
      groupIds: Array.from(report.groupIds).sort(),
      communityIds: Array.from(report.communityIds).sort(),
      topicLabels: Array.from(report.topicLabels).sort().slice(0, 8),
      sourceIds: report.sourceIds.slice(0, 80),
      representativePaths: uniqueOrdered(report.paths).slice(0, 12),
      convergenceMode: report.groupIds.size > 1
        ? "multi-topic-domain"
        : report.groupIds.size === 1
          ? "single-topic-domain"
          : "support-or-empty-domain",
      evidenceDensity: Number((report.windowCount / Math.max(1, report.sourceIds.length)).toFixed(4))
    }))
    .sort((left, right) => right.distillableSourceCount - left.distillableSourceCount || left.domainKey.localeCompare(right.domainKey));
}

function buildProjectAgentQueryIndex({ domainReports = [], classification = {}, corpusPlan = {} } = {}) {
  const domainBySourceId = new Map();
  for (const domain of domainReports) {
    for (const sourceId of domain.sourceIds || []) {
      domainBySourceId.set(sourceId, domain);
    }
  }
  const topicGroups = (classification.groups || [])
    .filter((group) => !group.excludedFromCore)
    .map((group) => {
      const domainIds = uniqueOrdered((group.sourceIds || [])
        .map((sourceId) => domainBySourceId.get(sourceId)?.domainId)
        .filter(Boolean));
      return {
        groupId: group.groupId,
        label: group.label,
        topicPath: group.topicHierarchy?.path || group.distillationUnit?.topicPath || [],
        sourceIds: group.sourceIds || [],
        domainIds,
        communityIds: (group.windowCommunities || []).map((community) => community.communityId),
        cohesionScore: group.cohesionScore || 0,
        separationScore: group.separationScore ?? null
      };
    });
  const routes = new Map();
  for (const document of corpusPlan.documents || []) {
    const routeId = document.route?.formatId || document.routeId || "unknown";
    if (!routes.has(routeId)) {
      routes.set(routeId, {
        routeId,
        sourceIds: [],
        domainIds: new Set()
      });
    }
    const route = routes.get(routeId);
    route.sourceIds.push(document.sourceId);
    const domain = domainBySourceId.get(document.sourceId);
    if (domain?.domainId) {
      route.domainIds.add(domain.domainId);
    }
  }
  return {
    strategy: "agent-project-convergence-query-index.v1",
    dimensions: ["projectDomain", "topicGroup", "windowCommunity", "source", "route", "timeRange"],
    domains: domainReports.map((domain) => ({
      domainId: domain.domainId,
      domainKey: domain.domainKey,
      label: domain.label,
      sourceIds: domain.sourceIds,
      groupIds: domain.groupIds,
      communityIds: domain.communityIds,
      routeIds: domain.routeIds
    })),
    topicGroups,
    routes: Array.from(routes.values()).map((route) => ({
      routeId: route.routeId,
      sourceIds: route.sourceIds,
      domainIds: Array.from(route.domainIds).sort()
    })).sort((left, right) => left.routeId.localeCompare(right.routeId)),
    recommendedQueryOrder: ["projectDomain", "topicGroup", "windowCommunity", "source", "timeRange"]
  };
}

function buildCrossDomainLinks(domainReports = [], classification = {}) {
  const domainBySourceId = new Map();
  for (const domain of domainReports) {
    for (const sourceId of domain.sourceIds || []) {
      domainBySourceId.set(sourceId, domain);
    }
  }
  return (classification.groups || [])
    .filter((group) => !group.excludedFromCore)
    .map((group) => {
      const domainIds = uniqueOrdered((group.sourceIds || [])
        .map((sourceId) => domainBySourceId.get(sourceId)?.domainId)
        .filter(Boolean));
      const domainKeys = uniqueOrdered((group.sourceIds || [])
        .map((sourceId) => domainBySourceId.get(sourceId)?.domainKey)
        .filter(Boolean));
      return {
        groupId: group.groupId,
        label: group.label,
        domainIds,
        domainKeys,
        sourceCount: (group.sourceIds || []).length,
        communityCount: group.communityCount || 0,
        relationship: domainIds.length > 1 ? "cross-domain-topic" : "single-domain-topic"
      };
    })
    .filter((link) => link.domainIds.length > 1)
    .sort((left, right) => right.sourceCount - left.sourceCount || left.label.localeCompare(right.label))
    .slice(0, 24);
}

function buildProjectConvergence({ corpusPlan, classification }) {
  const distillableGroups = classification.groups.filter((group) => group.sourceCount > 0 && !group.excludedFromCore);
  const domainReports = buildProjectDomainReports({ corpusPlan, classification });
  const agentQueryIndex = buildProjectAgentQueryIndex({ domainReports, classification, corpusPlan });
  const crossDomainLinks = buildCrossDomainLinks(domainReports, classification);
  const dominantGroups = distillableGroups
    .slice()
    .sort((left, right) => right.sourceCount - left.sourceCount || right.cohesionScore - left.cohesionScore)
    .slice(0, 5)
    .map((group) => ({
      groupId: group.groupId,
      label: group.label,
      sourceCount: group.sourceCount,
      cohesionScore: group.cohesionScore,
      separationScore: group.separationScore,
      communityCount: group.communityCount || 0,
      sourceIds: group.sourceIds
    }));
  const communityReports = distillableGroups.flatMap((group) => (
    (group.windowCommunities || []).slice(0, 6).map((community) => ({
      communityId: community.communityId,
      groupId: group.groupId,
      title: community.title,
      sourceIds: community.sourceIds,
      windowCount: community.windowCount,
      cohesionScore: community.cohesionScore,
      findings: community.summary.slice(0, 5)
    }))
  ));
  const averageSeparation = distillableGroups.length
    ? Number((
        distillableGroups.reduce((sum, group) => sum + Number(group.separationScore ?? 1), 0) /
        Math.max(1, distillableGroups.length)
      ).toFixed(4))
    : 0;
  return {
    strategy: PROJECT_CONVERGENCE_STRATEGY,
    previousStrategies: ["window-community-topic-project-convergence.v2"],
    layers: ["window", "window-community", "document", "project-domain", "topic-group", "project"],
    totalSources: corpusPlan.sourceCount,
    distillableSources: corpusPlan.distillableSourceCount,
    totalWindows: corpusPlan.windowCount,
    communityCount: communityReports.length,
    domainCount: domainReports.length,
    groupCount: classification.groupCount,
    dominantGroups,
    domainReports,
    crossDomainLinks,
    agentQueryIndex,
    communityReports,
    projectSynthesis: {
      mode: dominantGroups.length > 1 ? "multi-topic-separated" : "single-topic",
      averageSeparation,
      globalLocalModes: [
        {
          mode: "global",
          use: ["domainReports", "communityReports", "crossDomainLinks"],
          purpose: "Read the whole project without downloading every text unit."
        },
        {
          mode: "local",
          use: ["agentQueryIndex.domains", "evidence?domain=..."],
          purpose: "Drill into a project domain, topic group, or source."
        },
        {
          mode: "timeline",
          use: ["evidence?timeFrom=...&timeTo=..."],
          purpose: "Filter date-bearing evidence without reparsing source files."
        }
      ],
      lowCouplingHighCohesion: distillableGroups.every((group) => (
        (group.separationScore ?? 1) >= CLASSIFICATION_SEPARATION_THRESHOLD &&
        group.cohesionScore >= LEADER_CLUSTER_THRESHOLD
      )),
      largeProjectReady: corpusPlan.sourceCount >= 8 || corpusPlan.windowCount >= 20 || domainReports.length >= 4
    },
    convergenceSummary:
      dominantGroups.length > 1
        ? "Sources are separated into multiple topic groups before project-level convergence."
        : dominantGroups.length === 1
          ? "Sources currently converge into one dominant topic group."
          : "No distillable source text was supplied."
  };
}

function normalizeProjectId(input = {}, corpusPlan = {}) {
  const explicit = String(
    input.projectId ||
    input.workspaceId ||
    input.repositoryId ||
    input.project?.id ||
    input.project?.name ||
    input.metadata?.projectId ||
    ""
  ).trim();
  if (explicit) {
    return explicit;
  }
  const sourceSignature = (corpusPlan.documents || [])
    .map((document) => document.sourceId || document.fileName || document.title)
    .sort()
    .join("|");
  return stableId("project", input.title || input.query || "external-knowledge-distillation", sourceSignature);
}

function snapshotDocument(document = {}) {
  const windows = (document.windowPlan?.windows || []).map((window) => ({
    windowId: window.windowId,
    index: window.index,
    startOffset: window.startOffset,
    endOffset: window.endOffset,
    contentHash: window.contentHash,
    timeRange: window.timeRange || null,
    elementRefs: window.elementRefs || [],
    elementTypes: window.elementTypes || [],
    headingPath: window.headingPath || []
  }));
  return {
    sourceId: document.sourceId,
    parentSourceId: document.parentSourceId || "",
    archivePath: document.archivePath || "",
    ...projectDomainMetadata(document),
    title: document.title,
    fileName: document.fileName,
    mediaType: document.mediaType,
    routeId: document.route?.formatId || "unknown",
    byteSize: document.byteSize || 0,
    contentHash: document.contentHash || "",
    textCharacters: document.quality?.textCharacters || 0,
    windowCount: windows.length,
    windows
  };
}

function buildProjectSnapshot({ projectId = "", corpusPlan = {}, classification = {}, convergence = {}, grounding = {}, createdAt = "" } = {}) {
  const documents = (corpusPlan.documents || []).map(snapshotDocument);
  const fingerprintParts = documents
    .map((document) => [
      document.sourceId,
      document.contentHash,
      document.routeId,
      document.windowCount,
      document.windows.map((window) => window.contentHash).join(",")
    ].join(":"))
    .sort();
  const projectFingerprint = `sha256:${sha(fingerprintParts.join("\n"))}`;
  const snapshotId = stableId("project_snapshot", projectId, projectFingerprint);
  const groups = (classification.groups || []).map((group) => ({
    groupId: group.groupId,
    kind: group.kind || "topic",
    label: group.label,
    excludedFromCore: Boolean(group.excludedFromCore),
    sourceIds: group.sourceIds || [],
    communityIds: (group.windowCommunities || []).map((community) => community.communityId),
    distillationUnitId: group.distillationUnit?.unitId || "",
    cohesionScore: group.cohesionScore || 0,
    separationScore: group.separationScore ?? null
  }));
  return {
    snapshotId,
    projectId,
    projectFingerprint,
    createdAt,
    documentCount: documents.length,
    distillableDocumentCount: documents.filter((document) => document.textCharacters > 0 || document.windowCount > 0).length,
    windowCount: documents.reduce((sum, document) => sum + document.windowCount, 0),
    groupCount: classification.groupCount || groups.length,
    communityCount: convergence.communityCount || 0,
    claimCount: grounding.claimCount || 0,
    documents,
    groups
  };
}

function latestPriorProjectSnapshot(priorRuns = [], projectId = "") {
  for (const run of priorRuns.slice().reverse()) {
    const plan = run.result?.incrementalPlan;
    if (plan?.projectId === projectId && plan.snapshot) {
      return {
        runId: run.runId,
        createdAt: run.createdAt,
        snapshot: plan.snapshot
      };
    }
  }
  return null;
}

function windowHashSet(snapshot = {}) {
  const hashes = new Set();
  for (const document of snapshot.documents || []) {
    for (const window of document.windows || []) {
      if (window.contentHash) {
        hashes.add(`${document.sourceId}:${window.contentHash}`);
      }
    }
  }
  return hashes;
}

function buildIncrementalPlan({ input = {}, corpusPlan = {}, classification = {}, convergence = {}, grounding = {}, priorRuns = [], createdAt = "" } = {}) {
  const projectId = normalizeProjectId(input, corpusPlan);
  const snapshot = buildProjectSnapshot({ projectId, corpusPlan, classification, convergence, grounding, createdAt });
  const prior = latestPriorProjectSnapshot(priorRuns, projectId);
  const currentDocuments = new Map(snapshot.documents.map((document) => [document.sourceId, document]));
  const previousDocuments = new Map((prior?.snapshot?.documents || []).map((document) => [document.sourceId, document]));
  const addedSourceIds = [];
  const changedSourceIds = [];
  const reusedSourceIds = [];
  for (const document of snapshot.documents) {
    const previous = previousDocuments.get(document.sourceId);
    if (!previous) {
      addedSourceIds.push(document.sourceId);
    } else if (previous.contentHash === document.contentHash && previous.windowCount === document.windowCount) {
      reusedSourceIds.push(document.sourceId);
    } else {
      changedSourceIds.push(document.sourceId);
    }
  }
  const removedSourceIds = Array.from(previousDocuments.keys()).filter((sourceId) => !currentDocuments.has(sourceId));
  const previousWindowHashes = windowHashSet(prior?.snapshot || {});
  let reusedWindowCount = 0;
  let addedWindowCount = 0;
  let changedWindowCount = 0;
  for (const document of snapshot.documents) {
    const previous = previousDocuments.get(document.sourceId);
    for (const window of document.windows || []) {
      const key = `${document.sourceId}:${window.contentHash}`;
      if (previousWindowHashes.has(key)) {
        reusedWindowCount += 1;
      } else if (previous) {
        changedWindowCount += 1;
      } else {
        addedWindowCount += 1;
      }
    }
  }
  const removedWindowCount = (prior?.snapshot?.documents || [])
    .filter((document) => !currentDocuments.has(document.sourceId))
    .reduce((sum, document) => sum + Number(document.windowCount || 0), 0);
  const totalComparedWindows = snapshot.windowCount + removedWindowCount;
  const reuseRatio = totalComparedWindows
    ? Number((reusedWindowCount / totalComparedWindows).toFixed(4))
    : prior ? 1 : 0;
  return {
    strategy: INCREMENTAL_CONVERGENCE_STRATEGY,
    projectId,
    snapshotId: snapshot.snapshotId,
    projectFingerprint: snapshot.projectFingerprint,
    mode: prior ? "incremental" : "full-snapshot",
    previousRunId: prior?.runId || "",
    previousSnapshotId: prior?.snapshot?.snapshotId || "",
    previousProjectFingerprint: prior?.snapshot?.projectFingerprint || "",
    changed: Boolean(!prior || addedSourceIds.length || changedSourceIds.length || removedSourceIds.length),
    addedSourceIds,
    changedSourceIds,
    removedSourceIds,
    reusedSourceIds,
    addedWindowCount,
    changedWindowCount,
    removedWindowCount,
    reusedWindowCount,
    reuseRatio,
    mergePolicy: [
      "reuse unchanged text units and window communities by content hash",
      "recompute changed or added source windows before topic convergence",
      "refresh claim grounding and promotion gates for affected topic groups",
      "preserve removed source ids in the incremental diff for auditability"
    ],
    referencePatterns: [
      "graphrag.period-size-incremental-merge",
      "graphrag.text-units-community-reports",
      "haystack.pipeline-snapshot",
      "llama-index.ref-doc-hash"
    ],
    snapshot
  };
}

function entityTypeForToken(token = "") {
  for (const [concept, aliases] of Object.entries(SEMANTIC_ALIAS_GROUPS)) {
    if (aliases.includes(token)) {
      return concept;
    }
  }
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(token)) {
    return "date";
  }
  if (/api|service|parser|runtime|storage|gateway|namespace|route|distillation|evidence|claim/i.test(token)) {
    return "technical";
  }
  if (/invoice|vendor|payment|tax|total|finance|supplier/i.test(token)) {
    return "finance";
  }
  return "concept";
}

function entityTitle(token = "") {
  return String(token || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function claimStatusToCovariateStatus(status = "") {
  if (status === "entailed") {
    return "TRUE";
  }
  if (status === "contradicted") {
    return "FALSE";
  }
  return "SUSPECTED";
}

function buildGraphEvidencePack({ runId = "", createdAt = "", documents = [], classification = {}, convergence = {}, grounding = {}, incrementalPlan = {} } = {}) {
  const groupBySourceId = new Map();
  const groupById = new Map();
  const communityByWindowId = new Map();
  for (const group of classification.groups || []) {
    groupById.set(group.groupId, group);
    for (const sourceId of group.sourceIds || []) {
      groupBySourceId.set(sourceId, group);
    }
    for (const community of group.windowCommunities || []) {
      for (const ref of community.windowRefs || []) {
        communityByWindowId.set(ref.windowId, { group, community });
      }
    }
  }

  const textUnits = [];
  const entityMap = new Map();
  const relationshipMap = new Map();
  const entityForToken = (token = "") => {
    const normalized = String(token || "").toLowerCase().trim();
    if (!normalized) {
      return null;
    }
    const id = stableId("graph_entity", normalized);
    if (!entityMap.has(id)) {
      entityMap.set(id, {
        id,
        human_readable_id: entityMap.size + 1,
        title: entityTitle(normalized),
        type: entityTypeForToken(normalized),
        description: "",
        text_unit_ids: [],
        source_ids: [],
        frequency: 0,
        degree: 0
      });
    }
    return entityMap.get(id);
  };

  for (const document of documents) {
    const group = groupBySourceId.get(document.sourceId) || null;
    const windows = document.windowPlan?.windows?.length
      ? document.windowPlan.windows
      : [{
          windowId: stableId("text_unit", document.sourceId, document.contentHash || document.text || ""),
          excerpt: firstSentence(document.text),
          contentHash: document.contentHash || sha(document.text || ""),
          index: 0,
          timeRange: document.timeRange || null
        }];
    for (const [index, window] of windows.entries()) {
      const text = String(window.excerpt || firstSentence(document.text) || "").trim();
      const textUnitId = window.windowId || stableId("text_unit", document.sourceId, String(index), window.contentHash || text);
      const communityContext = communityByWindowId.get(textUnitId);
      const tokens = topTokens(textTokens(`${document.title}\n${text}`), 8);
      const entityIds = [];
      for (const token of tokens) {
        const entity = entityForToken(token);
        if (!entity) {
          continue;
        }
        if (!entity.text_unit_ids.includes(textUnitId)) {
          entity.text_unit_ids.push(textUnitId);
          entity.frequency += 1;
        }
        if (!entity.source_ids.includes(document.sourceId)) {
          entity.source_ids.push(document.sourceId);
        }
        entityIds.push(entity.id);
      }
      textUnits.push({
        id: textUnitId,
        human_readable_id: textUnits.length + 1,
        text,
        n_tokens: textTokens(text).size,
        document_id: document.sourceId,
        sourceId: document.sourceId,
        title: document.title,
        group_ids: group?.groupId ? [group.groupId] : [],
        community_ids: communityContext?.community?.communityId ? [communityContext.community.communityId] : [],
        entity_ids: uniqueOrdered(entityIds),
        relationships_ids: [],
        covariate_ids: [],
        metadata: {
          routeId: document.route?.formatId || "unknown",
          parentSourceId: document.parentSourceId || "",
          archivePath: document.archivePath || "",
          ...projectDomainMetadata(document),
          contentHash: window.contentHash || document.contentHash || "",
          timeRange: window.timeRange || document.timeRange || null,
          elementRefs: window.elementRefs || [],
          elementTypes: window.elementTypes || [],
          headingPath: window.headingPath || [],
          semanticChunkStrategy: window.semanticChunkStrategy || "",
          boundaryReason: window.boundaryReason || ""
        }
      });
    }
  }

  const textUnitById = new Map(textUnits.map((textUnit) => [textUnit.id, textUnit]));
  for (const textUnit of textUnits) {
    const entityIds = textUnit.entity_ids.slice(0, 6);
    for (let leftIndex = 0; leftIndex < entityIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entityIds.length; rightIndex += 1) {
        const [sourceEntityId, targetEntityId] = [entityIds[leftIndex], entityIds[rightIndex]].sort();
        const relationshipId = stableId("graph_relationship", sourceEntityId, targetEntityId);
        if (!relationshipMap.has(relationshipId)) {
          relationshipMap.set(relationshipId, {
            id: relationshipId,
            human_readable_id: relationshipMap.size + 1,
            source: sourceEntityId,
            target: targetEntityId,
            type: "co_occurs_in_text_unit",
            description: "Entities co-occur in a source text unit.",
            weight: 0,
            combined_degree: 0,
            text_unit_ids: []
          });
        }
        const relationship = relationshipMap.get(relationshipId);
        relationship.weight += 1;
        if (!relationship.text_unit_ids.includes(textUnit.id)) {
          relationship.text_unit_ids.push(textUnit.id);
        }
        textUnit.relationships_ids.push(relationshipId);
      }
    }
  }

  for (const relationship of relationshipMap.values()) {
    const source = entityMap.get(relationship.source);
    const target = entityMap.get(relationship.target);
    if (source) {
      source.degree += 1;
    }
    if (target) {
      target.degree += 1;
    }
  }
  for (const relationship of relationshipMap.values()) {
    relationship.combined_degree = (entityMap.get(relationship.source)?.degree || 0) + (entityMap.get(relationship.target)?.degree || 0);
  }
  for (const entity of entityMap.values()) {
    entity.description = `${entity.title} appears in ${entity.frequency} text unit(s).`;
  }

  const covariates = (grounding.claims || []).map((claim, index) => {
    const evidence = claim.topEvidence?.[0] || claim.conflictEvidence?.[0] || null;
    const evidenceTextUnit = textUnits.find((textUnit) => textUnit.sourceId === evidence?.sourceId);
    const claimTokens = topTokens(textTokens(claim.text), 4);
    const subject = entityForToken(claimTokens[0] || "claim") || {};
    const object = entityForToken(claimTokens[1] || claimTokens[0] || "evidence") || {};
    const covariateId = stableId("graph_covariate", claim.claimId);
    if (evidenceTextUnit) {
      evidenceTextUnit.covariate_ids.push(covariateId);
    }
    return {
      id: covariateId,
      human_readable_id: index + 1,
      covariate_type: "claim",
      type: claim.source || "generated-summary",
      description: claim.text,
      subject_id: subject.id || "",
      object_id: object.id || "",
      status: claimStatusToCovariateStatus(claim.status),
      source_text: evidence?.excerpt || claim.text,
      text_unit_id: evidenceTextUnit?.id || "",
      claim_id: claim.claimId,
      group_id: claim.groupId || "",
      support_score: claim.supportScore || 0,
      conflict_score: claim.conflictScore || 0
    };
  });

  const entities = Array.from(entityMap.values()).sort((left, right) => right.frequency - left.frequency || left.title.localeCompare(right.title));
  const relationships = Array.from(relationshipMap.values()).sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
  const communities = (classification.groups || []).map((group, index) => {
    const groupTextUnits = textUnits.filter((textUnit) => textUnit.group_ids.includes(group.groupId));
    const entityIds = uniqueOrdered(groupTextUnits.flatMap((textUnit) => textUnit.entity_ids));
    const relationshipIds = uniqueOrdered(groupTextUnits.flatMap((textUnit) => textUnit.relationships_ids));
    return {
      id: group.groupId,
      human_readable_id: index + 1,
      community: index + 1,
      parent: 0,
      children: (group.windowCommunities || []).map((community) => community.communityId),
      level: 0,
      title: group.label,
      kind: group.kind || "topic",
      entity_ids: entityIds,
      relationship_ids: relationshipIds,
      text_unit_ids: groupTextUnits.map((textUnit) => textUnit.id),
      period: createdAt,
      size: entityIds.length
    };
  });
  const communityReports = (convergence.communityReports || []).map((report, index) => {
    const group = groupById.get(report.groupId) || {};
    return {
      id: stableId("graph_community_report", report.communityId || report.groupId || String(index)),
      human_readable_id: index + 1,
      community: index + 1,
      parent: 0,
      children: [],
      level: 1,
      title: report.title || group.label || `Community ${index + 1}`,
      summary: (report.findings || []).slice(0, 2).join(" "),
      full_content: (report.findings || []).join("\n"),
      rank: Number((report.cohesionScore || 0).toFixed(4)),
      rating_explanation: "Rank is derived from deterministic window-community cohesion.",
      findings: (report.findings || []).map((finding, findingIndex) => ({
        summary: finding,
        explanation: `Finding ${findingIndex + 1} is backed by window community ${report.communityId || ""}.`
      })),
      period: createdAt,
      size: report.windowCount || 0
    };
  });

  return {
    protocolVersion: `${PROTOCOL_VERSION}.graph-evidence`,
    strategy: GRAPH_EVIDENCE_STRATEGY,
    runId,
    projectId: incrementalPlan.projectId || "",
    projectFingerprint: incrementalPlan.projectFingerprint || "",
    generatedAt: createdAt,
    referencePatterns: [
      "graphrag.text-units-entities-relationships",
      "graphrag.covariates-claims",
      "graphrag.community-reports",
      "llama-index.nodes-with-score",
      "haystack.document-metadata"
    ],
    summary: {
      textUnitCount: textUnits.length,
      entityCount: entities.length,
      relationshipCount: relationships.length,
      covariateCount: covariates.length,
      communityCount: communities.length,
      communityReportCount: communityReports.length
    },
    text_units: textUnits,
    entities,
    relationships,
    covariates,
    communities,
    community_reports: communityReports
  };
}

function graphEvidenceSummary(graphEvidence = {}) {
  return {
    strategy: graphEvidence.strategy || GRAPH_EVIDENCE_STRATEGY,
    summary: graphEvidence.summary || {},
    referencePatterns: graphEvidence.referencePatterns || []
  };
}

function normalizeEvidenceQuery(searchParams = new URLSearchParams()) {
  const read = (...names) => {
    for (const name of names) {
      const value = searchParams.get(name);
      if (value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return "";
  };
  const rawLimit = Number(read("limit", "pageSize", "page-size") || 50);
  const rawStatus = read("claimStatus", "claim-status", "status").toUpperCase();
  const statusAliases = {
    ENTAILED: "TRUE",
    SUPPORTED: "TRUE",
    TRUE: "TRUE",
    CONTRADICTED: "FALSE",
    FALSE: "FALSE",
    NEUTRAL: "SUSPECTED",
    SUSPECTED: "SUSPECTED"
  };
  const timeFrom = normalizeDateValue(read("timeFrom", "time-from", "from"), false);
  const timeTo = normalizeDateValue(read("timeTo", "time-to", "to"), false);
  return {
    entity: read("entity", "entityQuery", "entity-query"),
    relationship: read("relationship", "relationshipQuery", "relationship-query"),
    claimStatus: statusAliases[rawStatus] || "",
    claim: read("claim", "claimQuery", "claim-query"),
    sourceId: read("sourceId", "source-id", "documentId", "document-id"),
    domain: read("domain", "projectDomain", "project-domain", "domainId", "domain-id"),
    routeId: read("routeId", "route-id", "format", "formatId", "format-id"),
    groupId: read("groupId", "group-id", "communityId", "community-id"),
    timeFrom,
    timeTo,
    limit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 50
  };
}

function includesNormalized(value = "", query = "") {
  if (!query) {
    return true;
  }
  return String(value || "").toLowerCase().includes(String(query || "").toLowerCase());
}

function evidenceTextUnitTimeMatches(textUnit = {}, filters = {}) {
  if (!filters.timeFrom && !filters.timeTo) {
    return true;
  }
  return dateRangeMatches(textUnit.metadata?.timeRange || null, {
    from: filters.timeFrom,
    to: filters.timeTo
  });
}

function buildEvidenceQueryResult({ runId = "", graphEvidence = {}, filters = {} } = {}) {
  const textUnits = graphEvidence.text_units || [];
  const entities = graphEvidence.entities || [];
  const relationships = graphEvidence.relationships || [];
  const covariates = graphEvidence.covariates || [];
  const communities = graphEvidence.communities || [];
  const communityReports = graphEvidence.community_reports || [];
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  const matchingEntityIds = new Set(
    entities
      .filter((entity) => (
        !filters.entity ||
        includesNormalized(entity.id, filters.entity) ||
        includesNormalized(entity.title, filters.entity) ||
        includesNormalized(entity.type, filters.entity) ||
        includesNormalized(entity.description, filters.entity)
      ))
      .map((entity) => entity.id)
  );
  const matchingRelationshipIds = new Set(
    relationships
      .filter((relationship) => {
        if (!filters.relationship) {
          return true;
        }
        const source = entityById.get(relationship.source);
        const target = entityById.get(relationship.target);
        return (
          includesNormalized(relationship.id, filters.relationship) ||
          includesNormalized(relationship.type, filters.relationship) ||
          includesNormalized(relationship.description, filters.relationship) ||
          includesNormalized(source?.title, filters.relationship) ||
          includesNormalized(target?.title, filters.relationship)
        );
      })
      .map((relationship) => relationship.id)
  );
  const hasClaimFilter = Boolean(filters.claimStatus || filters.claim);
  const matchingCovariateIds = new Set(
    covariates
      .filter((covariate) => (
        (!filters.claimStatus || covariate.status === filters.claimStatus) &&
        (!filters.claim ||
          includesNormalized(covariate.description, filters.claim) ||
          includesNormalized(covariate.source_text, filters.claim) ||
          includesNormalized(covariate.claim_id, filters.claim) ||
          includesNormalized(covariate.type, filters.claim))
      ))
      .map((covariate) => covariate.id)
  );
  const covariateTextUnitIds = new Set(
    covariates
      .filter((covariate) => matchingCovariateIds.has(covariate.id))
      .map((covariate) => covariate.text_unit_id)
      .filter(Boolean)
  );
  const hasTextUnitScopedFilters = Boolean(
    filters.sourceId ||
    filters.domain ||
    filters.routeId ||
    filters.groupId ||
    filters.entity ||
    filters.relationship ||
    filters.timeFrom ||
    filters.timeTo
  );

  const scopedTextUnits = textUnits.filter((textUnit) => {
    if (filters.sourceId && textUnit.sourceId !== filters.sourceId && textUnit.document_id !== filters.sourceId) {
      return false;
    }
    if (filters.domain) {
      const domainMatches = (
        includesNormalized(textUnit.metadata?.projectDomain, filters.domain) ||
        includesNormalized(textUnit.metadata?.projectDomainId, filters.domain) ||
        includesNormalized(textUnit.metadata?.projectPath, filters.domain) ||
        includesNormalized(textUnit.metadata?.archivePath, filters.domain) ||
        includesNormalized(textUnit.sourceId, filters.domain)
      );
      if (!domainMatches) {
        return false;
      }
    }
    if (filters.routeId && textUnit.metadata?.routeId !== filters.routeId) {
      return false;
    }
    if (filters.groupId && !(textUnit.group_ids || []).includes(filters.groupId) && !(textUnit.community_ids || []).includes(filters.groupId)) {
      return false;
    }
    if (!evidenceTextUnitTimeMatches(textUnit, filters)) {
      return false;
    }
    if (filters.entity) {
      const hasEntity = (textUnit.entity_ids || []).some((entityId) => matchingEntityIds.has(entityId));
      if (!hasEntity && !includesNormalized(textUnit.text, filters.entity) && !includesNormalized(textUnit.title, filters.entity)) {
        return false;
      }
    }
    if (filters.relationship && !(textUnit.relationships_ids || []).some((relationshipId) => matchingRelationshipIds.has(relationshipId))) {
      return false;
    }
    if (hasClaimFilter) {
      const hasCovariate = (textUnit.covariate_ids || []).some((covariateId) => matchingCovariateIds.has(covariateId));
      if (!hasCovariate && !covariateTextUnitIds.has(textUnit.id)) {
        return false;
      }
    }
    return true;
  }).slice(0, filters.limit);

  const selectedTextUnitIds = new Set(scopedTextUnits.map((textUnit) => textUnit.id));
  const selectedEntityIds = new Set(scopedTextUnits.flatMap((textUnit) => textUnit.entity_ids || []));
  const selectedRelationshipIds = new Set(scopedTextUnits.flatMap((textUnit) => textUnit.relationships_ids || []));
  const selectedCovariateIds = new Set(scopedTextUnits.flatMap((textUnit) => textUnit.covariate_ids || []));
  for (const covariate of covariates) {
    if (selectedTextUnitIds.has(covariate.text_unit_id)) {
      selectedCovariateIds.add(covariate.id);
    }
  }
  if (hasClaimFilter && !hasTextUnitScopedFilters && scopedTextUnits.length === 0) {
    for (const covariateId of matchingCovariateIds) {
      selectedCovariateIds.add(covariateId);
    }
  }

  const returnedEntities = entities.filter((entity) => selectedEntityIds.has(entity.id));
  const returnedRelationships = relationships.filter((relationship) => (
    selectedRelationshipIds.has(relationship.id) ||
    (selectedEntityIds.has(relationship.source) && selectedEntityIds.has(relationship.target))
  ));
  const returnedCovariates = covariates.filter((covariate) => (
    selectedCovariateIds.has(covariate.id) &&
    (!filters.claimStatus || covariate.status === filters.claimStatus) &&
    (!filters.claim ||
      includesNormalized(covariate.description, filters.claim) ||
      includesNormalized(covariate.source_text, filters.claim) ||
      includesNormalized(covariate.claim_id, filters.claim) ||
      includesNormalized(covariate.type, filters.claim))
  ));
  const returnedCommunityIds = new Set(scopedTextUnits.flatMap((textUnit) => textUnit.group_ids || []));
  const returnedCommunities = communities.filter((community) => returnedCommunityIds.has(community.id));
  const returnedCommunityHumanIds = new Set(returnedCommunities.map((community) => community.human_readable_id));
  const returnedCommunityTitles = new Set(returnedCommunities.map((community) => community.title));
  const returnedCommunityReports = communityReports.filter((report) => (
    returnedCommunityHumanIds.has(report.community) ||
    returnedCommunityHumanIds.has(report.human_readable_id) ||
    returnedCommunityTitles.has(report.title)
  ));

  const counts = {
    original: {
      text_units: textUnits.length,
      entities: entities.length,
      relationships: relationships.length,
      covariates: covariates.length,
      communities: communities.length,
      community_reports: communityReports.length
    },
    returned: {
      text_units: scopedTextUnits.length,
      entities: returnedEntities.length,
      relationships: returnedRelationships.length,
      covariates: returnedCovariates.length,
      communities: returnedCommunities.length,
      community_reports: returnedCommunityReports.length
    },
    filteredOut: {
      text_units: Math.max(0, textUnits.length - scopedTextUnits.length),
      entities: Math.max(0, entities.length - returnedEntities.length),
      relationships: Math.max(0, relationships.length - returnedRelationships.length),
      covariates: Math.max(0, covariates.length - returnedCovariates.length)
    }
  };

  return {
    protocolVersion: `${PROTOCOL_VERSION}.evidence-query`,
    strategy: EVIDENCE_QUERY_STRATEGY,
    runId,
    generatedAt: nowIso(),
    sourceEvidenceStrategy: graphEvidence.strategy || GRAPH_EVIDENCE_STRATEGY,
    filters,
    counts,
    text_units: scopedTextUnits,
    entities: returnedEntities,
    relationships: returnedRelationships,
    covariates: returnedCovariates,
    communities: returnedCommunities,
    community_reports: returnedCommunityReports,
    nextActions: scopedTextUnits.length
      ? [
          "Use returned text_units as bounded source evidence.",
          "Use returned covariates for claim status checks.",
          "Escalate to evidence-pack-json only when a wider graph traversal is required."
        ]
      : [
          "Relax entity, claim, relationship, domain, route, source, group, or time filters.",
          "Inspect counts.original to confirm the run contains graph evidence."
        ]
  };
}

function normalizeProjectEvidenceQuery(searchParams = new URLSearchParams()) {
  const filters = normalizeEvidenceQuery(searchParams);
  const mode = String(searchParams.get("mode") || "all").trim().toLowerCase() === "latest" ? "latest" : "all";
  const rawRunLimit = Number(searchParams.get("runLimit") || searchParams.get("run-limit") || 20);
  return {
    filters,
    mode,
    runLimit: Number.isFinite(rawRunLimit) ? Math.max(1, Math.min(100, Math.floor(rawRunLimit))) : 20
  };
}

function projectIdForRun(run = {}) {
  return String(
    run.result?.incrementalPlan?.projectId ||
    run.sourcePlan?.incrementalPlan?.projectId ||
    run.inputSummary?.projectId ||
    run.result?.graphEvidence?.projectId ||
    ""
  ).trim();
}

function graphHasEvidence(graphEvidence = {}) {
  return Boolean(
    (graphEvidence.text_units || []).length ||
    (graphEvidence.entities || []).length ||
    (graphEvidence.relationships || []).length ||
    (graphEvidence.covariates || []).length ||
    (graphEvidence.communities || []).length ||
    (graphEvidence.community_reports || []).length
  );
}

function projectRunsForEvidence({ runs = [], projectId = "", mode = "all", runLimit = 20 } = {}) {
  const normalizedProjectId = String(projectId || "").trim();
  const matchingRuns = runs
    .filter((run) => (
      projectIdForRun(run) === normalizedProjectId &&
      graphHasEvidence(run.result?.graphEvidence || {})
    ))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const limitedRuns = matchingRuns.slice(-runLimit);
  const selectedRuns = mode === "latest" ? limitedRuns.slice(-1) : limitedRuns;
  return {
    totalMatchedRunCount: matchingRuns.length,
    selectedRuns
  };
}

function prefixGraphId(runId = "", id = "", fallback = "") {
  const safeId = String(id || fallback || "unknown");
  return `${runId}:${safeId}`;
}

function prefixGraphIds(runId = "", values = []) {
  return uniqueOrdered((values || []).filter(Boolean).map((value) => prefixGraphId(runId, value)));
}

function withRunMetadata(item = {}, run = {}) {
  return {
    ...item,
    sourceRunId: run.runId,
    sourceRunCreatedAt: run.createdAt || "",
    metadata: {
      ...(item.metadata || {}),
      sourceRunId: run.runId,
      sourceRunCreatedAt: run.createdAt || "",
      sourceProjectFingerprint: run.result?.incrementalPlan?.projectFingerprint || run.inputSummary?.projectFingerprint || ""
    }
  };
}

function mergeProjectGraphEvidence({ projectId = "", selectedRuns = [] } = {}) {
  const textUnits = [];
  const entities = [];
  const relationships = [];
  const covariates = [];
  const communities = [];
  const communityReports = [];
  let entityHumanId = 1;
  let relationshipHumanId = 1;
  let covariateHumanId = 1;
  let communityHumanId = 1;
  let communityReportHumanId = 1;

  for (const run of selectedRuns) {
    const runId = run.runId;
    const graphEvidence = run.result?.graphEvidence || {};
    const communityHumanIds = new Map();

    for (const entity of graphEvidence.entities || []) {
      entities.push(withRunMetadata({
        ...entity,
        id: prefixGraphId(runId, entity.id, `entity-${entityHumanId}`),
        human_readable_id: entityHumanId
      }, run));
      entityHumanId += 1;
    }

    for (const relationship of graphEvidence.relationships || []) {
      relationships.push(withRunMetadata({
        ...relationship,
        id: prefixGraphId(runId, relationship.id, `relationship-${relationshipHumanId}`),
        human_readable_id: relationshipHumanId,
        source: relationship.source ? prefixGraphId(runId, relationship.source) : "",
        target: relationship.target ? prefixGraphId(runId, relationship.target) : "",
        text_unit_ids: prefixGraphIds(runId, relationship.text_unit_ids || [])
      }, run));
      relationshipHumanId += 1;
    }

    for (const covariate of graphEvidence.covariates || []) {
      covariates.push(withRunMetadata({
        ...covariate,
        id: prefixGraphId(runId, covariate.id, `covariate-${covariateHumanId}`),
        human_readable_id: covariateHumanId,
        subject_id: covariate.subject_id ? prefixGraphId(runId, covariate.subject_id) : "",
        object_id: covariate.object_id ? prefixGraphId(runId, covariate.object_id) : "",
        text_unit_id: covariate.text_unit_id ? prefixGraphId(runId, covariate.text_unit_id) : "",
        group_id: covariate.group_id ? prefixGraphId(runId, covariate.group_id) : ""
      }, run));
      covariateHumanId += 1;
    }

    for (const community of graphEvidence.communities || []) {
      const prefixedCommunityId = prefixGraphId(runId, community.id, `community-${communityHumanId}`);
      const originalHumanId = community.human_readable_id || community.community || communityHumanId;
      communityHumanIds.set(String(originalHumanId), communityHumanId);
      communities.push(withRunMetadata({
        ...community,
        id: prefixedCommunityId,
        human_readable_id: communityHumanId,
        community: communityHumanId,
        children: prefixGraphIds(runId, community.children || []),
        entity_ids: prefixGraphIds(runId, community.entity_ids || []),
        relationship_ids: prefixGraphIds(runId, community.relationship_ids || []),
        text_unit_ids: prefixGraphIds(runId, community.text_unit_ids || [])
      }, run));
      communityHumanId += 1;
    }

    for (const textUnit of graphEvidence.text_units || []) {
      const originalGroupIds = uniqueOrdered([
        ...(textUnit.group_ids || []),
        ...(textUnit.community_ids || [])
      ]);
      textUnits.push(withRunMetadata({
        ...textUnit,
        id: prefixGraphId(runId, textUnit.id, `text-unit-${textUnits.length + 1}`),
        entity_ids: prefixGraphIds(runId, textUnit.entity_ids || []),
        relationships_ids: prefixGraphIds(runId, textUnit.relationships_ids || []),
        covariate_ids: prefixGraphIds(runId, textUnit.covariate_ids || []),
        group_ids: uniqueOrdered([
          ...prefixGraphIds(runId, textUnit.group_ids || []),
          ...originalGroupIds
        ]),
        community_ids: uniqueOrdered([
          ...prefixGraphIds(runId, textUnit.community_ids || []),
          ...originalGroupIds
        ])
      }, run));
    }

    for (const report of graphEvidence.community_reports || []) {
      const originalCommunityId = String(report.community || report.human_readable_id || "");
      const mergedCommunityId = communityHumanIds.get(originalCommunityId) || communityReportHumanId;
      communityReports.push(withRunMetadata({
        ...report,
        id: prefixGraphId(runId, report.id, `community-report-${communityReportHumanId}`),
        human_readable_id: mergedCommunityId,
        community: mergedCommunityId
      }, run));
      communityReportHumanId += 1;
    }
  }

  return {
    protocolVersion: `${PROTOCOL_VERSION}.project-graph-evidence`,
    strategy: GRAPH_EVIDENCE_STRATEGY,
    projectId,
    generatedAt: nowIso(),
    runIds: selectedRuns.map((run) => run.runId),
    projectFingerprints: uniqueOrdered(selectedRuns.map((run) => run.result?.incrementalPlan?.projectFingerprint || run.inputSummary?.projectFingerprint || "").filter(Boolean)),
    referencePatterns: [
      "graphrag.global-community-search",
      "graphrag.period-size-incremental-merge",
      "llama-index.ref-doc-hash",
      "haystack.pipeline-snapshot"
    ],
    text_units: textUnits,
    entities,
    relationships,
    covariates,
    communities,
    community_reports: communityReports,
    summary: {
      textUnitCount: textUnits.length,
      entityCount: entities.length,
      relationshipCount: relationships.length,
      covariateCount: covariates.length,
      communityCount: communities.length,
      communityReportCount: communityReports.length
    }
  };
}

function buildProjectEvidenceQueryResult({ projectId = "", runs = [], query = {} } = {}) {
  const { mode, runLimit, filters } = query;
  const { totalMatchedRunCount, selectedRuns } = projectRunsForEvidence({ runs, projectId, mode, runLimit });
  const mergedGraphEvidence = mergeProjectGraphEvidence({ projectId, selectedRuns });
  const evidence = buildEvidenceQueryResult({
    runId: projectId,
    graphEvidence: mergedGraphEvidence,
    filters
  });
  const latestRun = selectedRuns[selectedRuns.length - 1] || null;
  return {
    protocolVersion: `${PROTOCOL_VERSION}.project-evidence-query`,
    strategy: PROJECT_EVIDENCE_QUERY_STRATEGY,
    evidenceQueryStrategy: evidence.strategy,
    projectId,
    generatedAt: evidence.generatedAt,
    mode,
    runLimit,
    totalMatchedRunCount,
    matchedRunCount: selectedRuns.length,
    runIds: selectedRuns.map((run) => run.runId),
    latestRunId: latestRun?.runId || "",
    projectFingerprints: mergedGraphEvidence.projectFingerprints,
    incrementalModes: selectedRuns.map((run) => ({
      runId: run.runId,
      mode: run.result?.incrementalPlan?.mode || "",
      projectFingerprint: run.result?.incrementalPlan?.projectFingerprint || ""
    })),
    mergedGraphSummary: mergedGraphEvidence.summary,
    sourceEvidenceStrategy: mergedGraphEvidence.strategy,
    filters: evidence.filters,
    counts: evidence.counts,
    text_units: evidence.text_units,
    entities: evidence.entities,
    relationships: evidence.relationships,
    covariates: evidence.covariates,
    communities: evidence.communities,
    community_reports: evidence.community_reports,
    nextActions: evidence.text_units.length
      ? [
          "Use sourceRunId fields to distinguish evidence from each project run.",
          "Use latestRunId for the current project state and runIds for historical convergence.",
          "Narrow with domain, routeId, groupId, sourceId, entity, claimStatus, or time filters when the project graph is large."
        ]
      : [
          "Relax project evidence filters or increase runLimit.",
          "Check totalMatchedRunCount to confirm whether the project has graph evidence.",
          "Create at least one completed distillation run with the requested projectId."
        ]
  };
}

function markdownTableCell(value = "") {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function buildMarkdown({ title, query, documents, classification, routePlan, corpusPlan, convergence, grounding, incrementalPlan, graphEvidence, modelDistillation = null, failure = null }) {
  const evidenceIndexes = new Map(documents.map((document, index) => [document.sourceId, index]));
  const routingRows = corpusPlan.documents
    .slice(0, 12)
    .map((document) => {
      const route = document.route;
      return [
        `| ${markdownTableCell(document.title)}`,
        markdownTableCell(route.formatId),
        markdownTableCell(route.preferredParser),
        markdownTableCell(document.windowPlan.windowCount),
        `${markdownTableCell(route.riskFlags.join(", ") || "none")} |`
      ].join(" | ");
    })
    .join("\n");
  const routingTable = routingRows
    ? [
        "| Source | Format | Parser | Windows | Risks |",
        "| --- | --- | --- | ---: | --- |",
        routingRows
      ].join("\n")
    : "- No source files were supplied.";
  const categorySections = classification.groups
    .map((group) => {
      const findings = group.documents
        .slice(0, 8)
        .map((document) => {
          const index = evidenceIndexes.get(document.sourceId) ?? 0;
          return `- ${firstSentence(document.text) || document.title} [${evidenceKey(index)}]`;
        })
        .join("\n");
      return [
        `### ${group.label}`,
        "",
        `Sources: ${group.sourceCount}; cohesion: ${group.cohesionScore}; separation: ${group.separationScore ?? "n/a"}; communities: ${group.communityCount || 0}; kind: ${group.kind || "topic"}`,
        "",
        findings || "- No source text was supplied."
      ].join("\n");
    })
    .join("\n\n");
  const evidence = documents
    .slice(0, 12)
    .map((document, index) => `- [${evidenceKey(index)}] ${document.title}: ${firstSentence(document.text)}`)
    .join("\n");
  return [
    `# ${title}`,
    "",
    "## Status",
    "",
    failure ? `Failed: ${failure.code} - ${failure.message}` : "Completed.",
    "",
    "## Scope",
    "",
    query || "External knowledge distillation request.",
    "",
    "## Source Routing",
    "",
    `Strategy: ${routePlan.strategy}`,
    "",
    routingTable,
    "",
    "## Category Distillations",
    "",
    categorySections || "- No source text was supplied.",
    "",
    "## Project Convergence",
    "",
    `Strategy: ${convergence.strategy}`,
    "",
    `Sources: ${convergence.totalSources}; distillable: ${convergence.distillableSources}; windows: ${convergence.totalWindows}; groups: ${convergence.groupCount}`,
    "",
    convergence.convergenceSummary,
    "",
    "## Incremental Plan",
    "",
    incrementalPlan
      ? `Strategy: ${incrementalPlan.strategy}; mode: ${incrementalPlan.mode}; reused windows: ${incrementalPlan.reusedWindowCount}; changed windows: ${incrementalPlan.changedWindowCount}; added windows: ${incrementalPlan.addedWindowCount}`
      : "No incremental project snapshot was generated.",
    "",
    "## Graph Evidence",
    "",
    graphEvidence
      ? `Strategy: ${graphEvidence.strategy}; text units: ${graphEvidence.summary.textUnitCount}; entities: ${graphEvidence.summary.entityCount}; relationships: ${graphEvidence.summary.relationshipCount}; claims: ${graphEvidence.summary.covariateCount}`
      : "No graph evidence pack was generated.",
    "",
    "## Model Distillation",
    "",
    modelDistillation?.status === "completed"
      ? [
          `Strategy: ${modelDistillation.strategy}; model: ${modelDistillation.modelAlias}; prompt: ${modelDistillation.request.promptCharacters} characters.`,
          "",
          modelDistillation.response.text
        ].join("\n")
      : `Skipped: ${modelDistillation?.reason || "model output unavailable"}.`,
    "",
    "## Grounding",
    "",
    `Strategy: ${grounding.strategy}`,
    "",
    `Claims: ${grounding.claimCount}; supported: ${grounding.supported}; neutral: ${grounding.neutral}; score: ${grounding.groundingScore}`,
    "",
    "## Evidence",
    "",
    evidence || "- No evidence available."
  ].join("\n");
}

function buildAgentMessage({ runId, title, query, workflowScope, scopeSelection, documents, classification, routePlan, corpusPlan, convergence, grounding, incrementalPlan, graphEvidence, modelDistillation, formatConversionPlan, runtimeStatus, failure = null }) {
  return {
    protocolVersion: `${PROTOCOL_VERSION}.agent-message`,
    responseProfile: "agent",
    runId,
    workflowScope,
    scopeSelection,
    status: failure ? "failed" : "completed",
    errors: failure ? [failure] : [],
    title,
    query,
    runtimeStatus,
    routePlan,
    corpusPlan: {
      strategy: corpusPlan.strategy,
      allSizePolicy: corpusPlan.allSizePolicy,
      inputDocumentPlan: corpusPlan.inputDocumentPlan || null,
      sourceCount: corpusPlan.sourceCount,
      distillableSourceCount: corpusPlan.distillableSourceCount,
      totalBytes: corpusPlan.totalBytes,
      totalCharacters: corpusPlan.totalCharacters,
      elementCount: corpusPlan.elementCount || 0,
      windowCount: corpusPlan.windowCount,
      timeFilter: corpusPlan.timeFilter || null,
      documents: corpusPlan.documents.map((document) => ({
        sourceId: document.sourceId,
        title: document.title,
        fileName: document.fileName,
        extension: document.extension,
        mediaType: document.mediaType,
        byteSize: document.byteSize,
        eventTime: document.eventTime,
        documentTime: document.documentTime,
        timeRange: document.timeRange,
        timeConfidence: document.timeConfidence,
        timeSignals: document.timeSignals,
        pdfProfile: document.pdfProfile || null,
        route: document.route,
        parseStatus: document.parseStatus,
        parserTrace: document.parserTrace,
        parseWarnings: document.parseWarnings,
        elementPlan: document.elementPlan || null,
        windowPlan: {
          strategy: document.windowPlan.strategy,
          windowCount: document.windowPlan.windowCount,
          maxCharacters: document.windowPlan.maxCharacters,
          overlapCharacters: document.windowPlan.overlapCharacters,
          windows: document.windowPlan.windows
        },
        quality: document.quality
      }))
    },
    convergence,
    incrementalPlan,
    modelDistillation,
    formatConversionPlan,
    graphEvidence,
    grounding,
    classification: {
      strategy: classification.strategy,
      taxonomyStrategy: classification.taxonomyStrategy,
      assignmentRationaleStrategy: classification.assignmentRationaleStrategy,
      groupCount: classification.groups.length,
      coreGroupCount: classification.coreGroupCount,
      garbageGroupCount: classification.garbageGroupCount,
      communityCount: classification.communityCount,
      referencePatterns: classification.referencePatterns,
      lowCouplingHighCohesion: classification.lowCouplingHighCohesion,
      groups: classification.groups.map((group) => ({
        groupId: group.groupId,
        label: group.label,
        keywords: group.keywords,
        topicHierarchy: group.topicHierarchy || null,
        kind: group.kind || "topic",
        excludedFromCore: Boolean(group.excludedFromCore),
        sourceCount: group.sourceCount,
        sourceIds: group.sourceIds,
        assignmentRationale: group.assignmentRationale || null,
        exclusionReasons: group.exclusionReasons || [],
        cohesionScore: group.cohesionScore,
        separationScore: group.separationScore ?? null,
        boundary: group.boundary || null,
        crossTopicLinks: group.crossTopicLinks || [],
        communityCount: group.communityCount || 0,
        windowCommunities: group.windowCommunities || [],
        distillationUnit: group.distillationUnit || null,
        embedding: group.embedding
      }))
    },
    outputs: classification.groups
      .filter((group) => {
        const promotionGate = grounding.promotionGates?.[group.groupId] || candidatePromotionGateForGroup(group, grounding);
        return !group.excludedFromCore && promotionGate.promoted;
      })
      .map((group) => ({
        groupId: group.groupId,
        label: group.label,
        promotionGate: grounding.promotionGates?.[group.groupId] || candidatePromotionGateForGroup(group, grounding),
        evidenceRefs: evidenceRefsForDocuments(documents, group.documents),
        windowCommunityIds: (group.windowCommunities || []).map((community) => community.communityId),
        distillationUnitId: group.distillationUnit?.unitId || "",
        summary: group.documents.map((document) => firstSentence(document.text)).filter(Boolean).slice(0, 4)
      }))
  };
}

function normalizeModelGatewayEndpoint(value = "") {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }
  const parsed = new URL(rawValue);
  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/api/agent-gateway/call";
  }
  return parsed.toString();
}

function resolveModelDistillationGatewayConfig(input = {}) {
  const endpoint = normalizeModelGatewayEndpoint(
    input.modelGatewayUrl ||
      input.agentGatewayUrl ||
      process.env.PACT_EXTERNAL_KD_MODEL_GATEWAY_URL ||
      process.env.PACT_AGENT_GATEWAY_URL ||
      ""
  );
  const modelAlias = String(
    input.modelAlias ||
      input.model ||
      input.agentModelAlias ||
      process.env.PACT_EXTERNAL_KD_MODEL_ALIAS ||
      ""
  ).trim();
  const token = String(
    input.modelGatewayToken ||
      input.agentGatewayToken ||
      process.env.PACT_EXTERNAL_KD_MODEL_GATEWAY_TOKEN ||
      process.env.PACT_AGENT_GATEWAY_TOKEN ||
      ""
  ).trim();
  const tokenHeader = String(process.env.PACT_EXTERNAL_KD_MODEL_GATEWAY_TOKEN_HEADER || "Authorization").trim() || "Authorization";
  const tokenPrefix = String(process.env.PACT_EXTERNAL_KD_MODEL_GATEWAY_TOKEN_PREFIX || "Bearer ").trimEnd();
  return {
    endpoint,
    modelAlias,
    token,
    tokenHeader,
    tokenPrefix: tokenPrefix ? `${tokenPrefix} ` : "",
    timeoutMs: Math.max(1000, Number(input.modelGatewayTimeoutMs || MODEL_GATEWAY_TIMEOUT_MS))
  };
}

function compactModelDocumentRecord(document = {}, index = 0) {
  return {
    index,
    sourceId: document.sourceId || "",
    title: document.title || document.fileName || "",
    fileName: document.fileName || "",
    routeId: document.route?.id || "",
    formatId: document.route?.formatId || "",
    parser: document.route?.preferredParser || "",
    byteSize: document.byteSize || 0,
    documentTime: document.documentTime || "",
    timeRange: document.timeRange || null,
    windowCount: document.windowPlan?.windowCount || 0,
    elementTypes: document.elementPlan?.elementTypes || {},
    parseWarnings: (document.parseWarnings || []).slice(0, 6),
    excerpt: firstSentence(document.text || "")
  };
}

function buildModelDistillationPrompt(distillationWorkflow = {}) {
  const modelInput = {
    task: "Knowledge distillation over parsed Pact documents. Preserve source chronology, structure, contradictions, and evidence references.",
    query: distillationWorkflow.query,
    workflowScope: distillationWorkflow.workflowScope,
    scopeSelection: distillationWorkflow.scopeSelection,
    timeFilter: distillationWorkflow.corpusPlan?.timeFilter || null,
    sourceSummary: {
      sourceCount: distillationWorkflow.allDocuments?.length || 0,
      distillableSourceCount: distillationWorkflow.documents?.length || 0,
      totalBytes: distillationWorkflow.corpusPlan?.totalBytes || 0,
      windowCount: distillationWorkflow.corpusPlan?.windowCount || 0
    },
    documents: (distillationWorkflow.documents || []).slice(0, 24).map(compactModelDocumentRecord),
    groups: (distillationWorkflow.classification?.groups || []).slice(0, 12).map((group) => ({
      groupId: group.groupId,
      label: group.label,
      kind: group.kind,
      sourceIds: group.sourceIds,
      keywords: group.keywords,
      cohesionScore: group.cohesionScore,
      separationScore: group.separationScore,
      excludedFromCore: Boolean(group.excludedFromCore)
    })),
    convergence: {
      strategy: distillationWorkflow.convergence?.strategy || "",
      summary: distillationWorkflow.convergence?.convergenceSummary || "",
      domains: distillationWorkflow.convergence?.domains?.slice?.(0, 8) || []
    },
    grounding: {
      strategy: distillationWorkflow.grounding?.strategy || "",
      claimCount: distillationWorkflow.grounding?.claimCount || 0,
      supported: distillationWorkflow.grounding?.supported || 0,
      contradicted: distillationWorkflow.grounding?.contradicted || 0,
      score: distillationWorkflow.grounding?.groundingScore || 0
    },
    requiredOutput: {
      language: "zh-CN",
      format: "concise JSON-compatible analysis text",
      constraints: [
        "Do not invent source facts.",
        "Flag weak chronology or context loss.",
        "Prefer evidence-backed distilled decisions and risks."
      ]
    }
  };
  const prompt = JSON.stringify(modelInput, null, 2);
  if (prompt.length <= MODEL_DISTILLATION_PROMPT_MAX_CHARACTERS) {
    return prompt;
  }
  return `${prompt.slice(0, MODEL_DISTILLATION_PROMPT_MAX_CHARACTERS)}\n...[truncated for model input budget]`;
}

function modelGatewayHeaders(config = {}) {
  const headers = {
    "content-type": "application/json",
    "x-pact-module": "external.knowledge.distillation",
    "x-pact-strategy": MODEL_DISTILLATION_GATEWAY_STRATEGY
  };
  if (config.token) {
    headers[config.tokenHeader] = `${config.tokenPrefix || ""}${config.token}`;
  }
  return headers;
}

function extractModelDistillationText(payload = {}) {
  if (typeof payload === "string") {
    return payload.trim();
  }
  return String(
    payload.text ||
      payload.answer ||
      payload.content ||
      payload.message ||
      payload.output ||
      payload.result?.text ||
      payload.result?.answer ||
      payload.result?.content ||
      payload.result?.message ||
      payload.response?.text ||
      payload.response?.answer ||
      payload.choices?.[0]?.message?.content ||
      payload.choices?.[0]?.text ||
      ""
  ).trim();
}

function modelDistillationSkippedState(distillationWorkflow = {}, reason = "") {
  return {
    ...distillationWorkflow,
    modelDistillation: {
      moduleBoundary: MODEL_DISTILLATION_MODULE_BOUNDARY,
      strategy: MODEL_DISTILLATION_GATEWAY_STRATEGY,
      status: "skipped",
      reason,
      requiredRealModelCall: true,
      generatedAt: nowIso()
    }
  };
}

async function callModelDistillationGateway({ distillationWorkflow = {}, config = {} } = {}) {
  const prompt = buildModelDistillationPrompt(distillationWorkflow);
  const payload = {
    moduleId: "external.knowledge.distillation",
    taskType: "knowledge_distillation",
    modelAlias: config.modelAlias,
    question: prompt,
    systemPrompt: [
      "You are the Pact external knowledge distillation model worker.",
      "Return grounded distillation analysis only from the supplied parsed document evidence.",
      "Preserve chronology, document structure, and uncertainty markers."
    ].join("\n"),
    parameters: {
      responseProfile: "machine-readable",
      temperature: 0.1,
      maxOutputTokens: 1800
    }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  let responseText = "";
  const startedAt = Date.now();
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: modelGatewayHeaders(config),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    responseText = await response.text();
  } finally {
    clearTimeout(timeout);
  }
  const durationMs = Date.now() - startedAt;
  let parsed = {};
  try {
    parsed = responseText ? JSON.parse(responseText) : {};
  } catch {
    parsed = { text: responseText };
  }
  if (!response.ok) {
    const error = new Error(`Model gateway call failed with HTTP ${response.status}`);
    error.statusCode = 502;
    error.code = "MODEL_GATEWAY_CALL_FAILED";
    error.details = { statusCode: response.status, endpoint: config.endpoint };
    throw error;
  }
  const modelText = extractModelDistillationText(parsed);
  if (!modelText) {
    const error = new Error("Model gateway returned an empty distillation response.");
    error.statusCode = 502;
    error.code = "MODEL_GATEWAY_EMPTY_RESPONSE";
    throw error;
  }
  return {
    moduleBoundary: MODEL_DISTILLATION_MODULE_BOUNDARY,
    strategy: MODEL_DISTILLATION_GATEWAY_STRATEGY,
    status: "completed",
    requiredRealModelCall: true,
    generatedAt: nowIso(),
    endpoint: config.endpoint,
    modelAlias: config.modelAlias,
    request: {
      promptCharacters: prompt.length,
      promptSha256: shaBuffer(Buffer.from(prompt, "utf8"))
    },
    response: {
      statusCode: response.status,
      durationMs,
      byteSize: Buffer.byteLength(responseText, "utf8"),
      sha256: shaBuffer(Buffer.from(responseText, "utf8")),
      text: modelText,
      raw: parsed
    }
  };
}

async function runModelDistillationModule(distillationWorkflow = {}, runtimeStatus = null) {
  if (!Array.isArray(distillationWorkflow.documents) || distillationWorkflow.documents.length === 0) {
    return modelDistillationSkippedState(distillationWorkflow, "no-distillable-documents");
  }
  const config = resolveModelDistillationGatewayConfig(distillationWorkflow.input || {});
  if (!config.endpoint) {
    const error = new Error("External knowledge distillation requires a configured model gateway endpoint.");
    error.statusCode = 503;
    error.code = "MODEL_GATEWAY_REQUIRED";
    throw error;
  }
  if (!config.modelAlias) {
    const error = new Error("External knowledge distillation requires a modelAlias for the model gateway call.");
    error.statusCode = 400;
    error.code = "MODEL_ALIAS_REQUIRED";
    throw error;
  }
  const modelDistillation = await callModelDistillationGateway({ distillationWorkflow, config, runtimeStatus });
  return {
    ...distillationWorkflow,
    modelDistillation
  };
}

async function runKnowledgeDistillationWorkflow(input = {}, runtimeStatus = null, priorRuns = [], referenceFrameworks = null) {
  const distillationWorkflow = await runDistillationWorkflow(input, runtimeStatus, priorRuns);
  const evaluation = evaluateDistillationWorkflow(distillationWorkflow, runtimeStatus, referenceFrameworks);
  return composeDistillationResult(distillationWorkflow, evaluation, runtimeStatus);
}

async function runDistillationWorkflow(input = {}, runtimeStatus = null, priorRuns = []) {
  const workflowContext = initializeDistillationWorkflow(input);
  const algorithmInput = prepareDistillationAlgorithmInput(workflowContext, runtimeStatus);
  const algorithmWorkflow = runDistillationAlgorithmWorkflow(algorithmInput, priorRuns);
  return runModelDistillationModule(algorithmWorkflow, runtimeStatus);
}

function runDistillationAlgorithmWorkflow(algorithmInput = {}, priorRuns = []) {
  assertDistillationAlgorithmInputContract(algorithmInput.allDocuments || []);
  const filteredInput = filterDistillationInputByTime(algorithmInput);
  const scopedInput = selectDistillationWorkflowScope(filteredInput);
  const corpusPlanState = buildDistillationCorpusPlan(scopedInput);
  const routePlanState = buildDistillationRoutePlan(corpusPlanState);
  const documentSet = buildDistillationDocumentSet(routePlanState);
  const classificationState = buildDistillationClassification(documentSet);
  const convergenceState = buildDistillationConvergence(classificationState);
  const groundingState = buildDistillationGrounding(convergenceState);
  const incrementalState = buildDistillationIncrementalPlan(groundingState, priorRuns);
  const graphEvidenceState = buildDistillationGraphEvidence(incrementalState);
  return composeDistillationWorkflowState(graphEvidenceState);
}

function normalizeDistillationWorkflowScope(input = {}) {
  const rawValue = String(
    input.workflowScope ||
      input.distillationWorkflowScope ||
      input.scope ||
      DEFAULT_DISTILLATION_WORKFLOW_SCOPE
  ).trim().toLowerCase().replace(/_/g, "-");
  const workflowScope = DISTILLATION_WORKFLOW_SCOPE_ALIASES[rawValue] || rawValue;
  if (!DISTILLATION_WORKFLOW_SCOPE_VALUES.includes(workflowScope)) {
    const error = new Error(`Invalid workflowScope enum value: ${rawValue}. Supported values: ${DISTILLATION_WORKFLOW_SCOPE_VALUES.join(", ")}.`);
    error.statusCode = 400;
    error.code = "INVALID_WORKFLOW_SCOPE";
    throw error;
  }
  return workflowScope;
}

function initializeDistillationWorkflow(input = {}) {
  const createdAt = nowIso();
  const query = String(input.query || input.prompt || input.title || "External knowledge distillation").trim();
  const title = String(input.title || query || "External Knowledge Distillation").trim();
  const runId = String(input.runId || "").trim() || stableId("external_kd_run", query, createdAt);
  const responseProfile = String(input.responseProfile || input.mode || "console").trim() || "console";
  const workflowScope = normalizeDistillationWorkflowScope(input);
  const requestedClaims = Array.isArray(input.claims)
    ? input.claims
    : Array.isArray(input.requestedClaims)
      ? input.requestedClaims
      : [];
  return {
    input,
    createdAt,
    query,
    title,
    runId,
    responseProfile,
    workflowScope,
    requestedClaims
  };
}

function prepareDistillationAlgorithmInput(workflowContext = {}, runtimeStatus = null) {
  const documentParsing = runDocumentParsingModule(workflowContext.input, runtimeStatus);
  return bindDocumentParsingToAlgorithmInput(workflowContext, documentParsing);
}

function filterDistillationInputByTime(normalizedInput = {}) {
  const timeFilter = normalizeTimeFilter(normalizedInput.input);
  const filtered = applyTimeFilterToDocuments(normalizedInput.allDocuments, timeFilter, {
    maxWindowCharacters: normalizedInput.input.maxWindowCharacters,
    windowOverlapCharacters: normalizedInput.input.windowOverlapCharacters
  });
  return {
    ...normalizedInput,
    timeFilter,
    filtered,
    activeDocuments: filtered.documents
  };
}

function documentWorkflowSelector(input = {}) {
  return String(
    input.targetDocumentId ||
      input.documentId ||
      input.sourceId ||
      input.fileName ||
      input.targetTitle ||
      input.documentTitle ||
      input.targetDocumentTitle ||
      ""
  ).trim();
}

function documentMatchesWorkflowSelector(document = {}, selector = "") {
  if (!selector) {
    return false;
  }
  return [
    document.sourceId,
    document.documentId,
    document.id,
    document.fileName,
    document.title,
    document.path,
    document.originalPath,
    document.contentRef
  ].some((value) => String(value || "") === selector);
}

function selectDocumentWorkflowDocuments(activeDocuments = [], input = {}) {
  const selector = documentWorkflowSelector(input);
  if (!selector) {
    return {
      selector,
      documents: activeDocuments.slice(0, 1)
    };
  }
  const selected = activeDocuments.filter((document) => documentMatchesWorkflowSelector(document, selector));
  if (selected.length === 0) {
    const error = new Error(`workflowScope=document selector did not match any active document: ${selector}`);
    error.statusCode = 400;
    error.code = "DOCUMENT_SCOPE_SELECTOR_NOT_FOUND";
    throw error;
  }
  if (selected.length > 1) {
    const error = new Error(`workflowScope=document selector matched multiple active documents: ${selector}`);
    error.statusCode = 400;
    error.code = "DOCUMENT_SCOPE_SELECTOR_AMBIGUOUS";
    throw error;
  }
  return {
    selector,
    documents: selected
  };
}

function selectDistillationWorkflowScope(filteredInput = {}) {
  if (filteredInput.workflowScope !== DISTILLATION_WORKFLOW_SCOPE.DOCUMENT) {
    return {
      ...filteredInput,
      scopeSelection: {
        workflowScope: filteredInput.workflowScope,
        strategy: "workflow-scope-pass-through.v1",
        inputDocumentCount: filteredInput.activeDocuments.length,
        selectedDocumentCount: filteredInput.activeDocuments.length,
        selectedSourceIds: filteredInput.activeDocuments.map((document) => document.sourceId).filter(Boolean)
      }
    };
  }
  const selected = selectDocumentWorkflowDocuments(filteredInput.activeDocuments, filteredInput.input);
  return {
    ...filteredInput,
    activeDocuments: selected.documents,
    scopeSelection: {
      workflowScope: filteredInput.workflowScope,
      strategy: "document-workflow-single-source-selection.v1",
      selector: selected.selector,
      inputDocumentCount: filteredInput.activeDocuments.length,
      selectedDocumentCount: selected.documents.length,
      selectedSourceIds: selected.documents.map((document) => document.sourceId).filter(Boolean)
    }
  };
}

function buildDistillationCorpusPlan(filteredInput = {}) {
  const corpusPlan = {
    ...buildCorpusPlan(filteredInput.activeDocuments, filteredInput.input),
    inputDocumentPlan: filteredInput.inputDocumentPlan,
    timeFilter: filteredInput.filtered.summary
  };
  return {
    ...filteredInput,
    corpusPlan
  };
}

function buildDistillationRoutePlan(corpusPlanState = {}) {
  return {
    ...corpusPlanState,
    routePlan: buildRoutePlan(corpusPlanState.corpusPlan)
  };
}

function documentWithCorpusPlan(document = {}, plannedBySourceId = new Map(), input = {}) {
  return {
    ...document,
    windowPlan: plannedBySourceId.get(document.sourceId)?.windowPlan || buildWindowPlan(document, input),
    route: plannedBySourceId.get(document.sourceId)?.route || document.route
  };
}

function buildDistillationDocumentSet(routePlanState = {}) {
  const plannedBySourceId = new Map(routePlanState.corpusPlan.documents.map((document) => [document.sourceId, document]));
  const containerSourceIds = new Set(routePlanState.activeDocuments.map((document) => document.parentSourceId).filter(Boolean));
  const documents = routePlanState.activeDocuments
    .filter((document) => document.text || containerSourceIds.has(document.sourceId))
    .map((document) => documentWithCorpusPlan(document, plannedBySourceId, routePlanState.input));
  const evidenceDocuments = routePlanState.activeDocuments
    .map((document) => documentWithCorpusPlan(document, plannedBySourceId, routePlanState.input))
    .filter((document) => document.text || document.windowPlan?.windowCount > 0);
  return {
    ...routePlanState,
    documents,
    evidenceDocuments
  };
}

function buildDocumentClassification(documents = []) {
  const groups = classifyDocuments(documents);
  return {
    strategy: CLASSIFICATION_STRATEGY,
    taxonomyStrategy: "semantic-concept-topic-hierarchy.v1",
    assignmentRationaleStrategy: "leader-clustering-semantic-concept-rationale.v1",
    referencePatterns: [
      "graphrag.community-reports",
      "llama-index.nodes-with-metadata",
      "haystack.explicit-pipeline-components"
    ],
    lowCouplingHighCohesion: {
      enforced: true,
      separationThreshold: CLASSIFICATION_SEPARATION_THRESHOLD,
      cohesionThreshold: LEADER_CLUSTER_THRESHOLD,
      garbageExcludedFromCore: true
    },
    embedding: {
      provider: "builtin:hashing-semantic-v1",
      dimensions: EMBEDDING_DIMENSIONS,
      clusterThreshold: LEADER_CLUSTER_THRESHOLD,
      windowCommunityThreshold: WINDOW_COMMUNITY_CLUSTER_THRESHOLD,
      crossTopicLinkThreshold: CROSS_TOPIC_LINK_THRESHOLD,
      garbageSignalThreshold: GARBAGE_SIGNAL_THRESHOLD
    },
    groupCount: groups.length,
    coreGroupCount: groups.filter((group) => !group.excludedFromCore).length,
    garbageGroupCount: groups.filter((group) => group.excludedFromCore).length,
    communityCount: groups.reduce((sum, group) => sum + Number(group.communityCount || 0), 0),
    groups
  };
}

function buildDistillationClassification(documentSet = {}) {
  return {
    ...documentSet,
    classification: buildDocumentClassification(documentSet.documents)
  };
}

function buildDistillationConvergence(classificationState = {}) {
  return {
    ...classificationState,
    convergence: buildProjectConvergence({
      corpusPlan: classificationState.corpusPlan,
      classification: classificationState.classification
    })
  };
}

function buildDistillationGrounding(convergenceState = {}) {
  return {
    ...convergenceState,
    grounding: buildGroundingReport({
      documents: convergenceState.documents,
      classification: convergenceState.classification,
      requestedClaims: convergenceState.requestedClaims
    })
  };
}

function buildDistillationIncrementalPlan(groundingState = {}, priorRuns = []) {
  return {
    ...groundingState,
    incrementalPlan: buildIncrementalPlan({
      input: groundingState.input,
      corpusPlan: groundingState.corpusPlan,
      classification: groundingState.classification,
      convergence: groundingState.convergence,
      grounding: groundingState.grounding,
      priorRuns,
      createdAt: groundingState.createdAt
    })
  };
}

function buildDistillationGraphEvidence(incrementalState = {}) {
  return {
    ...incrementalState,
    graphEvidence: buildGraphEvidencePack({
      runId: incrementalState.runId,
      createdAt: incrementalState.createdAt,
      documents: incrementalState.evidenceDocuments,
      classification: incrementalState.classification,
      convergence: incrementalState.convergence,
      grounding: incrementalState.grounding,
      incrementalPlan: incrementalState.incrementalPlan
    })
  };
}

function composeDistillationWorkflowState(graphEvidenceState = {}) {
  return {
    createdAt: graphEvidenceState.createdAt,
    allDocuments: graphEvidenceState.allDocuments,
    inputDocumentPlan: graphEvidenceState.inputDocumentPlan,
    algorithmInputContract: graphEvidenceState.algorithmInputContract,
    timeFilter: graphEvidenceState.timeFilter,
    corpusPlan: graphEvidenceState.corpusPlan,
    routePlan: graphEvidenceState.routePlan,
    documents: graphEvidenceState.documents,
    evidenceDocuments: graphEvidenceState.evidenceDocuments,
    query: graphEvidenceState.query,
    title: graphEvidenceState.title,
    runId: graphEvidenceState.runId,
    responseProfile: graphEvidenceState.responseProfile,
    workflowScope: graphEvidenceState.workflowScope,
    scopeSelection: graphEvidenceState.scopeSelection,
    classification: graphEvidenceState.classification,
    convergence: graphEvidenceState.convergence,
    grounding: graphEvidenceState.grounding,
    incrementalPlan: graphEvidenceState.incrementalPlan,
    graphEvidence: graphEvidenceState.graphEvidence,
    modelDistillation: graphEvidenceState.modelDistillation || null
  };
}

function evaluateDistillationWorkflow(distillationWorkflow = {}, runtimeStatus = null, referenceFrameworks = null) {
  const {
    allDocuments = [],
    documents = [],
    timeFilter = {},
    corpusPlan = {},
    runId = "",
    classification = {},
    graphEvidence = {},
    grounding = {},
    incrementalPlan = {}
  } = distillationWorkflow;
  const rawDistillableCount = allDocuments.filter((document) => document.text).length;
  const passed = documents.length > 0;
  const failure = passed
    ? null
    : timeFilter.active && rawDistillableCount > 0
      ? {
          code: "TIME_FILTERED_CORPUS_EMPTY",
          message: "No distillable source matched the requested time filter.",
          recoverable: true,
          recommendedAction: "Relax from/to/confidenceMin, set includeUnknownTime, or choose a different timeField."
        }
      : {
          code: "EMPTY_RAW_CORPUS",
          message: "No distillable text was produced from the supplied documents.",
          recoverable: true,
          recommendedAction: "Supply text, contentBase64, or an allowed filePath/contentRef for a supported direct parser, or enable the required binary parser runtime."
        };
  const referenceGapReport = buildReferenceGapReport(referenceFrameworks, {
    runtimeStatus,
    run: {
      runId,
      status: passed ? "completed" : "failed",
      inputSummary: {
        sourceCount: allDocuments.length,
        distillableSourceCount: documents.length,
        windowCount: corpusPlan.windowCount
      },
      result: {
        algorithmVersion: "external-service.route-window-community-claim-gated-graph-incremental-distillation.v5",
        classification,
        graphEvidence
      }
    }
  });
  return {
    rawDistillableCount,
    passed,
    failure,
    referenceGapReport,
    qualityReport: buildDistillationQualityReport({
      distillationWorkflow,
      evaluation: { passed, referenceGapReport },
      runtimeStatus
    })
  };
}

function buildDistillationQualityReport({ distillationWorkflow = {}, evaluation = {}, runtimeStatus = null } = {}) {
  const {
    documents = [],
    corpusPlan = {},
    classification = {},
    grounding = {},
    incrementalPlan = {},
    graphEvidence = {}
  } = distillationWorkflow;
  const passed = evaluation.passed === true;
  const referenceGapReport = evaluation.referenceGapReport || {};
  return {
    protocolVersion: PROTOCOL_VERSION,
    passed,
    overallScore: passed ? (grounding.passed ? 0.8 : 0.68) : 0,
    sourceCoverage: documents.length,
    routing: {
      supportedSourceCount: corpusPlan.documents.filter((document) => document.route.formatId !== "unknown").length,
      riskySourceCount: corpusPlan.documents.filter((document) => document.route.riskFlags.length > 0).length
    },
    corpus: {
      allSizePolicy: corpusPlan.allSizePolicy,
      inputDocumentPlan: corpusPlan.inputDocumentPlan || null,
      windowCount: corpusPlan.windowCount,
      totalBytes: corpusPlan.totalBytes,
      totalCharacters: corpusPlan.totalCharacters
    },
    incremental: {
      strategy: incrementalPlan.strategy,
      mode: incrementalPlan.mode,
      projectId: incrementalPlan.projectId,
      reuseRatio: incrementalPlan.reuseRatio,
      reusedWindowCount: incrementalPlan.reusedWindowCount,
      changedWindowCount: incrementalPlan.changedWindowCount,
      addedWindowCount: incrementalPlan.addedWindowCount,
      removedWindowCount: incrementalPlan.removedWindowCount
    },
    graphEvidence: graphEvidence.summary,
    referenceGaps: {
      strategy: referenceGapReport.strategy,
      frameworkCount: referenceGapReport.referenceFrameworks.count,
      openGapCount: referenceGapReport.openGaps.length
    },
    runtime: runtimeStatus?.summary || null,
    classification: {
      groupCount: classification.groupCount,
      coreGroupCount: classification.coreGroupCount,
      garbageGroupCount: classification.garbageGroupCount,
      communityCount: classification.communityCount,
      strategy: classification.strategy,
      taxonomyStrategy: classification.taxonomyStrategy,
      assignmentRationaleStrategy: classification.assignmentRationaleStrategy,
      averageCohesion: Number(
        (
          classification.groups.reduce((sum, group) => sum + group.cohesionScore, 0) /
          Math.max(1, classification.groupCount)
        ).toFixed(4)
      ),
      averageSeparation: Number(
        (
          classification.groups
            .filter((group) => !group.excludedFromCore)
            .reduce((sum, group) => sum + Number(group.separationScore ?? 1), 0) /
          Math.max(1, classification.coreGroupCount)
        ).toFixed(4)
      )
    },
    grounding: {
      passed: grounding.passed,
      claimCount: grounding.claimCount,
      groundingScore: grounding.groundingScore,
      neutral: grounding.neutral,
      contradicted: grounding.contradicted
    }
  };
}

function composeDistillationResult(distillationWorkflow = {}, evaluation = {}, runtimeStatus = null) {
  const {
    createdAt,
    allDocuments,
    inputDocumentPlan,
    algorithmInputContract,
    corpusPlan,
    routePlan,
    documents,
    query,
    title,
    runId,
    responseProfile,
    workflowScope,
    scopeSelection,
    classification,
    convergence,
    grounding,
    incrementalPlan,
    graphEvidence,
    modelDistillation
  } = distillationWorkflow;
  const { passed, failure, referenceGapReport, qualityReport } = evaluation;
  const markdown = buildMarkdown({ title, query, documents, classification, routePlan, corpusPlan, convergence, grounding, incrementalPlan, graphEvidence, modelDistillation, failure });
  const formatConversionPlan = runFormatConversionModule({
    runId,
    corpusPlan,
    title,
    createdAt,
    updatedAt: createdAt,
    markdown
  });
  const agentMessage = buildAgentMessage({
    runId,
    title,
    query,
    workflowScope,
    scopeSelection,
    documents,
    classification,
    routePlan,
    corpusPlan,
    convergence,
    grounding,
    incrementalPlan,
    graphEvidence,
    modelDistillation,
    formatConversionPlan,
    runtimeStatus,
    failure
  });
  const portableDocument = {
    protocolVersion: "portable.knowledge-distillation.v1",
    title,
    markdown,
    responseProfile: "human-readable",
    workflowScope,
    scopeSelection,
    selfContained: true,
    runtimeDependencies: [],
    status: passed ? "completed" : "failed",
    errors: failure ? [failure] : [],
    runtimeStatus,
    routePlan,
    corpusPlan: {
      strategy: corpusPlan.strategy,
      allSizePolicy: corpusPlan.allSizePolicy,
      inputDocumentPlan: corpusPlan.inputDocumentPlan || null,
      sourceCount: corpusPlan.sourceCount,
      distillableSourceCount: corpusPlan.distillableSourceCount,
      totalBytes: corpusPlan.totalBytes,
      totalCharacters: corpusPlan.totalCharacters,
      elementCount: corpusPlan.elementCount || 0,
      windowCount: corpusPlan.windowCount,
      timeFilter: corpusPlan.timeFilter
    },
    convergence,
    incrementalPlan,
    modelDistillation,
    formatConversionPlan,
    graphEvidence: graphEvidenceSummary(graphEvidence),
    grounding,
    classification: {
      strategy: classification.strategy,
      taxonomyStrategy: classification.taxonomyStrategy,
      assignmentRationaleStrategy: classification.assignmentRationaleStrategy,
      groupCount: classification.groupCount,
      coreGroupCount: classification.coreGroupCount,
      garbageGroupCount: classification.garbageGroupCount,
      communityCount: classification.communityCount,
      referencePatterns: classification.referencePatterns,
      lowCouplingHighCohesion: classification.lowCouplingHighCohesion,
      embedding: classification.embedding,
      groups: classification.groups.map(publicClassificationGroup)
    },
    citations: documents.slice(0, 12).map((document, index) => ({
      citationKey: evidenceKey(index),
      title: document.title,
      sourceId: document.sourceId,
      excerpt: firstSentence(document.text)
    })),
    evidenceAppendix: documents.slice(0, 12).map((document, index) => ({
      citationKey: evidenceKey(index),
      sourceId: document.sourceId,
      title: document.title,
      excerpt: firstSentence(document.text),
      contentHash: document.contentHash
    }))
  };
  return {
    protocolVersion: PROTOCOL_VERSION,
    serviceName: SERVICE_NAME,
    serviceKind: SERVICE_KIND,
    runId,
    status: passed ? "completed" : "failed",
    responseProfile,
    workflowScope,
    scopeSelection,
    title,
    query,
    createdAt,
    updatedAt: createdAt,
    inputSummary: {
      sourceCount: allDocuments.length,
      algorithmInputContract,
      workflowScope,
      scopeSelection,
      inputDocumentPlan,
      projectId: incrementalPlan.projectId,
      projectFingerprint: incrementalPlan.projectFingerprint,
      distillableSourceCount: documents.length,
      totalBytes: corpusPlan.totalBytes,
      windowCount: corpusPlan.windowCount,
      totalChars: documents.reduce((sum, document) => sum + Number(document.totalTextCharacters || document.text.length || 0), 0),
      timeFilter: corpusPlan.timeFilter,
      modelDistillation: modelDistillation
        ? {
            moduleBoundary: modelDistillation.moduleBoundary,
            strategy: modelDistillation.strategy,
            status: modelDistillation.status,
            modelAlias: modelDistillation.modelAlias || ""
          }
        : null
    },
    sourcePlan: {
      strategy: "external_service_route_window_community_claim_gated_graph_incremental_distillation_v5",
      workflowScope,
      scopeSelection,
      sourceCount: allDocuments.length,
      distillableSourceCount: documents.length,
      groupCount: classification.groupCount,
      routePlan,
      incrementalPlan,
      graphEvidence: graphEvidenceSummary(graphEvidence),
      modelDistillation,
      corpusPlan: {
        strategy: corpusPlan.strategy,
        allSizePolicy: corpusPlan.allSizePolicy,
        inputDocumentPlan: corpusPlan.inputDocumentPlan || null,
        totalBytes: corpusPlan.totalBytes,
        totalCharacters: corpusPlan.totalCharacters,
        elementCount: corpusPlan.elementCount || 0,
        windowCount: corpusPlan.windowCount,
        timeFilter: corpusPlan.timeFilter
      },
      generatedAt: createdAt
    },
    result: {
      status: passed ? "completed" : "failed",
      algorithmVersion: "external-service.route-window-community-claim-gated-graph-incremental-distillation.v5",
      algorithmInputContract,
      workflowScope,
      scopeSelection,
      errors: failure ? [failure] : [],
      agentMessage,
      runtimeStatus,
      routePlan,
      corpusPlan,
      convergence,
      incrementalPlan,
      modelDistillation,
      formatConversionPlan,
      graphEvidence,
      referenceGapReport,
      grounding,
      classification: {
        strategy: classification.strategy,
        taxonomyStrategy: classification.taxonomyStrategy,
        assignmentRationaleStrategy: classification.assignmentRationaleStrategy,
        groupCount: classification.groupCount,
        coreGroupCount: classification.coreGroupCount,
        garbageGroupCount: classification.garbageGroupCount,
        communityCount: classification.communityCount,
        referencePatterns: classification.referencePatterns,
        lowCouplingHighCohesion: classification.lowCouplingHighCohesion,
        embedding: classification.embedding,
        groups: classification.groups.map(publicClassificationGroup)
      },
      portableDocuments: [{ document: portableDocument }],
      candidates: classification.groups
        .filter((group) => !group.excludedFromCore)
        .map((group, index) => {
          const promotionGate = grounding.promotionGates?.[group.groupId] || candidatePromotionGateForGroup(group, grounding);
          return {
            candidateId: stableId("external_candidate", runId, group.groupId, index),
            title: group.label,
            sourceIds: group.sourceIds,
            promoted: promotionGate.promoted,
            promotionGate,
            distillationUnitId: group.distillationUnit?.unitId || "",
            windowCommunityIds: (group.windowCommunities || []).map((community) => community.communityId),
            cohesionScore: group.cohesionScore,
            separationScore: group.separationScore,
            evidenceRefs: evidenceRefsForDocuments(documents, group.documents),
            groundingRefs: grounding.claims
              .filter((claim) => claim.groupId === group.groupId)
              .map((claim) => claim.claimId)
          };
        })
        .filter((candidate) => candidate.promoted),
      qualityReport
    },
    artifactRefs: [
      {
        artifactId: "portable-markdown",
        label: "Portable Markdown",
        contentType: "text/markdown; charset=utf-8",
        fileName: `${runId}.md`
      },
      {
        artifactId: "portable-docx",
        label: "Portable DOCX",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: `${runId}.docx`
      },
      {
        artifactId: "console-summary-json",
        label: "Console Summary JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.console-summary.json`
      },
      {
        artifactId: "result-json",
        label: "Result JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.json`
      },
      {
        artifactId: "agent-message-json",
        label: "Agent Message JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.agent.json`
      },
      {
        artifactId: "project-snapshot-json",
        label: "Project Snapshot JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.project-snapshot.json`
      },
      {
        artifactId: "evidence-pack-json",
        label: "Graph Evidence Pack JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.evidence-pack.json`
      },
      {
        artifactId: "format-conversion-plan-json",
        label: "Format Conversion Plan JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.format-conversion-plan.json`
      },
      {
        artifactId: "professional-format-manifest-json",
        label: "Professional Format Manifest JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.professional-format-manifest.json`
      },
      {
        artifactId: "reference-gap-report-json",
        label: "Reference Gap Report JSON",
        contentType: "application/json; charset=utf-8",
        fileName: `${runId}.reference-gap-report.json`
      },
      {
        artifactId: "workspace-package-zip",
        label: "Workspace Package ZIP",
        contentType: "application/zip",
        fileName: `${runId}.workspace-package.zip`
      }
    ]
  };
}

async function createRun(input = {}, runtimeStatus = null, priorRuns = [], referenceFrameworks = null) {
  return runKnowledgeDistillationWorkflow(input, runtimeStatus, priorRuns, referenceFrameworks);
}

function capabilities(referenceFrameworks = null, runtimeStatus = null) {
  const supportedExtensions = Array.from(ROUTES_BY_EXTENSION.keys()).sort();
  const supportedMediaTypes = Array.from(ROUTES_BY_MEDIA_TYPE.keys()).sort();
  return {
    protocolVersion: PROTOCOL_VERSION,
    serviceName: SERVICE_NAME,
    serviceKind: SERVICE_KIND,
    api: {
      health: "GET /health",
      capabilities: "GET /v1/capabilities",
      runtimeHealth: "GET /v1/runtime/health",
      referenceGapReport: "GET /v1/reference-gap-report",
      listRuns: "GET /v1/distillation/runs",
      createRun: "POST /v1/distillation/runs",
      getRun: "GET /v1/distillation/runs/:runId",
      cancelRun: "POST /v1/distillation/runs/:runId/cancel",
      evidenceQuery: "GET /v1/distillation/runs/:runId/evidence",
      projectEvidenceQuery: "GET /v1/projects/:projectId/evidence",
      exportArtifact: "GET /v1/distillation/runs/:runId/artifacts/:artifactId"
    },
    artifacts: ["portable-markdown", "portable-docx", "console-summary-json", "result-json", "agent-message-json", "project-snapshot-json", "evidence-pack-json", "format-conversion-plan-json", "professional-format-manifest-json", "reference-gap-report-json", "workspace-package-zip"],
    responseProfiles: ["console", "agent", "api"],
    workflowScopes: {
      requestField: "workflowScope",
      type: "enum",
      enumValues: DISTILLATION_WORKFLOW_SCOPE_VALUES,
      defaultValue: DEFAULT_DISTILLATION_WORKFLOW_SCOPE,
      aliases: Object.keys(DISTILLATION_WORKFLOW_SCOPE_ALIASES),
      documentSelectorFields: ["targetDocumentId", "documentId", "sourceId", "fileName", "targetTitle", "documentTitle", "targetDocumentTitle"],
      semantics: {
        document: "Run the single-document workflow after input normalization and time filtering.",
        corpus: "Run a multi-document corpus workflow without requiring project-level intent.",
        project: "Run the default project-level multi-document workflow with convergence and incremental state."
      }
    },
    responseProfileSeparation: humanAgentModeSeparation(),
    pipelineSeparation: {
      strategy: "document-ingestion-vs-distillation-core-boundary.v1",
      documentIngestionAdapter: {
        moduleBoundary: DOCUMENT_PARSING_MODULE_BOUNDARY,
        strategy: DOCUMENT_INGESTION_ADAPTER_STRATEGY,
        outputContract: DISTILLATION_DOCUMENT_INPUT_CONTRACT,
        owns: ["payloadModes", "filePath", "contentRef", "contentBase64", "manifest", "formatRouting", "parserTrace"],
        outputFields: ["sourceId", "title", "text", "metadata", "route", "structureElements", "parserTrace", "contentHash"]
      },
      distillationAlgorithmCore: {
        moduleBoundary: DISTILLATION_ALGORITHM_MODULE_BOUNDARY,
        inputContract: DISTILLATION_ALGORITHM_INPUT_CONTRACT,
        owns: ["workflowScope", "timeFilter", "corpusPlan", "classification", "grounding", "incrementalPlan", "graphEvidence"],
        forbiddenInputFields: PARSER_PAYLOAD_FIELD_NAMES
      },
      modelDistillation: {
        moduleBoundary: MODEL_DISTILLATION_MODULE_BOUNDARY,
        strategy: MODEL_DISTILLATION_GATEWAY_STRATEGY,
        owns: ["realModelInvocation", "modelDistillation", "modelEvidenceSynthesis"],
        requires: ["agent-gateway", "modelAlias", "modelGatewayEndpoint"]
      },
      formatConversion: {
        moduleBoundary: FORMAT_CONVERSION_MODULE_BOUNDARY,
        strategy: "office-document-professional-adaptation.v1",
        owns: ["portable-markdown", "portable-docx", "agent-message-json", "workspace-package-zip"]
      }
    },
    distillationAlgorithm: {
      inputContract: DISTILLATION_ALGORITHM_INPUT_CONTRACT,
      documentContract: DISTILLATION_DOCUMENT_INPUT_CONTRACT,
      parserPayloadFieldsAllowed: false,
      entrypoint: "runDistillationAlgorithmWorkflow"
    },
    modelDistillation: {
      supported: true,
      moduleBoundary: MODEL_DISTILLATION_MODULE_BOUNDARY,
      strategy: MODEL_DISTILLATION_GATEWAY_STRATEGY,
      requiredRealModelCall: true,
      gatewayEndpointConfigured: Boolean(process.env.PACT_EXTERNAL_KD_MODEL_GATEWAY_URL || process.env.PACT_AGENT_GATEWAY_URL),
      modelAliasConfigured: Boolean(process.env.PACT_EXTERNAL_KD_MODEL_ALIAS),
      timeoutMs: MODEL_GATEWAY_TIMEOUT_MS,
      promptMaxCharacters: MODEL_DISTILLATION_PROMPT_MAX_CHARACTERS,
      noBuiltinFallback: true,
      dependency: "agent-gateway"
    },
    algorithms: [
      "external-service.route-window-embedding-grounded-distillation.v1",
      "external-service.route-window-community-grounded-distillation.v2",
      "external-service.route-window-community-claim-gated-distillation.v3",
      "external-service.route-window-community-claim-gated-incremental-distillation.v4",
      "external-service.route-window-community-claim-gated-graph-incremental-distillation.v5",
      CLASSIFICATION_STRATEGY,
      "semantic-concept-topic-hierarchy.v1",
      "leader-clustering-semantic-concept-rationale.v1",
      PROJECT_CONVERGENCE_STRATEGY,
      "agent-project-convergence-query-index.v1",
      DOCUMENT_INGESTION_ADAPTER_STRATEGY,
      DISTILLATION_ALGORITHM_INPUT_CONTRACT,
      "inline-or-streaming-manifest-document-input.v1",
      "structured-json-file-ref-streaming-window.v1",
      "directory-file-ref-recursive-routing.v1",
      "visio-opc-shape-parser.v1",
      "document-element-model.v1",
      "element-aware-by-title-windowing.v1",
      PDF_SUBTYPE_ROUTING_STRATEGY,
      "content-signature-routing.v1",
      "timed-transcript-cue-parser.v1",
      "xbrl-financial-fact-parser.v1",
      "audio-transcript-sidecar-routing.v1",
      "human-agent-response-profile-separation.v1",
      "professional-format-manifest.v1",
      "bounded-binary-file-profile.v1",
      FORMAT_ROUTES_CONFIG_STRATEGY,
      DOCUMENT_PARSING_MODULE_BOUNDARY,
      DISTILLATION_ALGORITHM_MODULE_BOUNDARY,
      MODEL_DISTILLATION_MODULE_BOUNDARY,
      FORMAT_CONVERSION_MODULE_BOUNDARY,
      MODEL_DISTILLATION_GATEWAY_STRATEGY,
      EVIDENCE_QUERY_STRATEGY,
      PROJECT_EVIDENCE_QUERY_STRATEGY,
      REFERENCE_GAP_REPORT_STRATEGY,
      REFERENCE_FRAMEWORK_AUDIT_STRATEGY
    ],
    timeFiltering: {
      supported: true,
      strategy: "document-window-time-filter.v1",
      requestFields: ["timeFilter.from", "timeFilter.to", "timeFilter.timeField", "timeFilter.confidenceMin", "timeFilter.excludeWeakEvidence", "timeFilter.includeUnknownTime"],
      timeFields: ["eventTime", "documentTime", "any"],
      corpusFields: ["timeRange", "timeConfidence", "timeSignals"]
    },
    fileCompatibility: {
      routingStrategy: "content-signature-extension-media-shape-routing.v2",
      routeOrder: ["contentSignature", "extension", "mediaType", "sourceKind", "textFallback"],
      routeRegistry: {
        protocolVersion: FORMAT_ROUTES_CONFIG_PROTOCOL_VERSION,
        strategy: FORMAT_ROUTES_CONFIG_STRATEGY,
        source: "external-services/knowledge-distillation-service/format-routes.json",
        routeCount: FORMAT_ROUTES.length,
        extensionCount: supportedExtensions.length,
        mediaTypeCount: supportedMediaTypes.length,
        validation: "startup-fail-fast"
      },
      contentSignatureRouting: {
        supported: true,
        strategy: "content-signature-routing.v1",
        maxSniffBytes: SIGNATURE_SNIFF_BYTES,
        signatures: [
          "pdf-header",
          "zip-ooxml-word",
          "zip-ooxml-presentation",
          "zip-ooxml-visio",
          "zip-ooxml-spreadsheet",
          "zip-opendocument",
          "zip-opendocument-spreadsheet",
          "zip-opendocument-presentation",
          "zip-epub",
          "zip-container",
          "png-header",
          "jpeg-header",
          "gif-header",
          "tiff-header",
          "webp-riff-header",
          "bmp-header",
          "gzip-header",
          "tar-ustar",
          "7z-header",
          "rtf-header",
          "html-leading-tag"
        ],
        fields: [
          "parserTrace[].stage=content.signature",
          "route.contentSignature",
          "route.sniffedExtension",
          "route.sniffedMediaType"
        ]
      },
      pdfSubtypeRouting: {
        supported: true,
        strategy: PDF_SUBTYPE_ROUTING_STRATEGY,
        subtypes: ["pdf-text", "pdf-scanned", "pdf-font-broken", "pdf-image-heavy", "pdf-encrypted", "pdf-empty-or-unknown"],
        fields: ["route.pdfSubtype", "corpusPlan.documents[].pdfProfile", "agentMessage.corpusPlan.documents[].pdfProfile"]
      },
      supportedExtensions,
      supportedMediaTypes,
      formats: FORMAT_ROUTES.map((route) => ({
        id: route.id,
        label: route.label,
        extensions: route.extensions,
        mediaTypes: route.mediaTypes,
        contentShape: route.contentShape,
        preferredParser: route.preferredParser,
        fallbackParsers: route.fallbackParsers,
        parserChain: route.parserChain,
        streamingUnit: route.streamingUnit,
        referenceFrameworks: route.referenceFrameworks
      }))
    },
    largeDocumentPolicy: {
      strategy: "streaming-windowed",
      defaultWindowCharacters: DEFAULT_WINDOW_CHARACTERS,
      defaultWindowOverlapCharacters: DEFAULT_WINDOW_OVERLAP_CHARACTERS,
      largeFileBytes: LARGE_FILE_BYTES,
      largeTextCharacters: LARGE_TEXT_CHARACTERS,
      manifestStrategy: "inline-or-streaming-manifest-document-input.v1",
      structuredZipFileRefStrategy: "structured-zip-entry-bounded-or-streaming.v1",
      directoryFileRefStrategy: "directory-file-ref-recursive-routing.v1",
      binaryProfileStrategy: "bounded-binary-file-profile.v1",
      structuredZipEntryMaxBytes: STRUCTURED_ZIP_ENTRY_MAX_BYTES,
      directoryExpansionMaxDepth: DIRECTORY_EXPANSION_MAX_DEPTH,
      directoryExpansionMaxFiles: DIRECTORY_EXPANSION_MAX_FILES,
      manifestMaxDocuments: MANIFEST_MAX_DOCUMENTS,
      manifestJsonDirectReadMaxBytes: MANIFEST_JSON_DIRECT_READ_MAX_BYTES,
      structuredJsonFileRefStrategy: "structured-json-file-ref-streaming-window.v1",
      sizeLimitPolicy: "resource-bounded-no-small-hard-cap"
    },
    parserExecution: {
      boundary: DOCUMENT_PARSING_MODULE_BOUNDARY,
      strategy: DOCUMENT_INGESTION_ADAPTER_STRATEGY,
      outputContract: DISTILLATION_DOCUMENT_INPUT_CONTRACT,
      consumedByAlgorithmContract: DISTILLATION_ALGORITHM_INPUT_CONTRACT,
      payloadModes: ["text", "contentBase64", "filePath", "contentRef", "rawDocumentsManifestPath", "rawDocumentsManifestRef", "jsonlManifest"],
      allowedInputRoots: INPUT_ROOTS,
      builtInParsers: [
        "input.manifest.jsonl",
        "input.manifest.json",
        "content.signature",
        "payload.file-ref",
        "payload.file-ref-deferred",
        "payload.file-ref-binary-profile",
        "payload.stream-text",
        "text.direct",
        "text.markdown",
        "markdown.frontmatter",
        "markdown.structure",
        "markup.structure",
        "structured.json",
        "structured.json.file-ref-stream",
        "config.key-value",
        "diagram.structure",
        "notebook.cells",
        "code.structure",
        "diff.unified",
        "calendar.ics",
        "transcript.cues",
        "transcript.webvtt",
        "transcript.srt",
        "transcript.speaker-turns",
        "xbrl.contexts",
        "xbrl.facts",
        "audio.metadata",
        "audio.transcript-sidecar",
        "table.csv",
        "table.tsv",
        "email.headers-body",
        "email.msg.tika",
        "email.msg.tika.file-ref",
        "email.mbox",
        "email.mbox-route",
        "email.attachment-route",
        "pdf.text.basic",
        "pdf.text.pdftotext",
        "pdf.subtype-route",
        "pdf.hyperlinks",
        "pdf.outlines",
        "pdf.form-fields",
        "structured-zip.file-ref",
        "structured-zip.structural-entry-plan",
        "structured-zip.large-entry-stream",
        "zip.manifest",
        "archive.expand-route",
        "archive.child-file.route",
        "archive.file-ref.expand",
        "archive.entry-file-ref",
        "directory.file-ref.expand",
        "directory.entry-file-ref",
        "archive.zip.container",
        "archive.zip.extract",
        "archive.tar.container",
        "archive.tar.extract",
        "archive.gzip.decompress",
        "archive.7z.extract",
        "office.word.structured",
        "office.word.styles",
        "office.word.numbering",
        "office.word.content-controls",
        "office.word.bookmarks",
        "office.word.headers-footers",
        "office.word.hyperlinks",
        "office.word.images",
        "office.word.charts",
        "office.word.revisions",
        "office.presentation.slides",
        "office.presentation.layouts",
        "office.presentation.placeholders",
        "office.presentation.tables",
        "office.presentation.hyperlinks",
        "office.presentation.images",
        "office.presentation.charts",
        "office.presentation.speaker-notes",
        "office.presentation.comments",
        "office.visio.pages",
        "office.visio.shapes",
        "office.visio.connectors",
        "office.visio.text",
        "office.word.tables",
        "office.word.annotations",
        "table.sheet.structured",
        "table.workbook.sheets",
        "table.workbook.defined-names",
        "table.sheet.headers",
        "table.sheet.cells",
        "table.sheet.merged-cells",
        "table.sheet.comments",
        "table.sheet.date-styles",
        "table.sheet.formulas",
        "table.sheet.hyperlinks",
        "table.sheet.charts",
        "table.time-index",
        "open-document.structured",
        "open-document.tables",
        "open-document.hyperlinks",
        "ebook.epub",
        "tika.text.app",
        "tika.text.file-ref",
        "ocr.image.tesseract",
        "pdf.ocr.poppler-tesseract"
      ],
      externalRuntimeRequired: ["tika.text", "pdf.visual.layout", "ocr.page", "ocr.image", "multimodal.image"],
      emptyCorpusErrorCode: "EMPTY_RAW_CORPUS"
    },
    elementModel: {
      supported: true,
      strategy: "document-element-model.v1",
      windowingStrategy: "element-aware-by-title-windowing.v1",
      elementTypes: ["title", "heading", "task-heading", "paragraph", "pdf-text-block", "pdf-outline", "pdf-form-field", "slide-layout", "slide-master", "slide-shape", "speaker-note", "visio-shape", "visio-connector", "list-item", "blockquote", "link", "image", "chart", "content-control", "bookmark", "header", "footer", "defined-name", "frontmatter", "table-header", "table-row", "merged-cell", "cell-comment", "comment", "footnote", "endnote", "revision", "code", "formula", "citation", "reference", "xml-field", "attribute", "metadata", "environment", "transcript-cue", "speaker-turn", "xbrl-fact"],
      structuredFormats: ["markdown", "html", "xml", "asciidoc", "latex", "docx", "pptx", "xlsx", "vsdx", "open-document", "epub", "pdf", "webvtt", "srt", "xbrl", "ixbrl"],
      geometryFields: ["page", "bbox", "layout.strategy", "layout.order", "layout.width", "layout.height", "shape.id", "shape.name", "shape.type", "shape.master", "shape.masterShape", "shape.placeholderType", "presentation.kind", "presentation.slidePart", "presentation.layoutPart", "presentation.masterPart", "presentation.relationshipId", "image.target", "image.relationshipId", "chart.chartPart", "chart.relationshipId", "chart.chartType", "chart.series", "form.name", "form.fieldType", "form.value", "control.alias", "control.tag", "control.controlType", "bookmark.name", "headerFooter.kind", "headerFooter.partName", "definedName.name", "definedName.ref", "definedName.builtinType", "codeBlock.language", "codeBlock.lineStart", "quote.depth", "transcript.cueId", "transcript.speaker", "transcript.start", "transcript.end", "xbrlFact.name", "xbrlFact.contextRef", "xbrlFact.unitRef", "xbrlFact.periodEnd", "table.sheet", "table.sheetName", "table.sheetId", "table.worksheetPath", "table.row", "merge.ref", "merge.masterRef", "cells.ref", "cells.dateIso", "cells.dateSerial", "cells.formula", "cells.hyperlink.target", "cells.merge.ref", "cells.comment.ref"],
      graphMetadata: ["elementRefs", "elementTypes", "headingPath", "semanticChunkStrategy", "boundaryReason", "elementRefs.page", "elementRefs.bbox", "elementRefs.layout", "elementRefs.table", "elementRefs.table.sheetName", "elementRefs.table.sheetId", "elementRefs.table.worksheetPath", "elementRefs.href", "elementRefs.frontmatter", "elementRefs.annotation", "elementRefs.style", "elementRefs.style.styleId", "elementRefs.style.numberingId", "elementRefs.shape", "elementRefs.shape.id", "elementRefs.shape.name", "elementRefs.shape.type", "elementRefs.shape.master", "elementRefs.shape.masterShape", "elementRefs.shape.placeholderType", "elementRefs.presentation", "elementRefs.presentation.layoutPart", "elementRefs.presentation.masterPart", "elementRefs.presentation.relationshipId", "elementRefs.image", "elementRefs.image.target", "elementRefs.image.relationshipId", "elementRefs.chart", "elementRefs.chart.chartPart", "elementRefs.chart.series", "elementRefs.form", "elementRefs.form.name", "elementRefs.form.value", "elementRefs.control", "elementRefs.control.alias", "elementRefs.control.tag", "elementRefs.bookmark", "elementRefs.bookmark.name", "elementRefs.headerFooter", "elementRefs.headerFooter.kind", "elementRefs.headerFooter.partName", "elementRefs.definedName", "elementRefs.definedName.name", "elementRefs.definedName.ref", "elementRefs.definedName.builtinType", "elementRefs.codeBlock", "elementRefs.codeBlock.language", "elementRefs.codeBlock.lineStart", "elementRefs.quote", "elementRefs.quote.depth", "elementRefs.transcript", "elementRefs.transcript.speaker", "elementRefs.transcript.start", "elementRefs.xbrlFact", "elementRefs.xbrlFact.contextRef", "elementRefs.xbrlFact.unitRef", "elementRefs.merge", "elementRefs.merge.ref", "elementRefs.cells", "elementRefs.cells.dateIso", "elementRefs.cells.dateSerial", "elementRefs.cells.formula", "elementRefs.cells.hyperlink", "elementRefs.cells.merge", "elementRefs.cells.comment"],
      referencePatterns: [
        "unstructured.elements",
        "unstructured.chunk_by_title",
        "unstructured.table-isolated-pre-chunks",
        "docling.docitem-labels",
        "llama-index.nodes-with-metadata"
      ]
    },
    formatConversion: {
      supported: true,
      strategy: "office-document-professional-adaptation.v1",
      qualityGateEvaluationStrategy: "professional-format-quality-gates.v1",
      outputArtifactValidationStrategy: "format-conversion-output-artifact-self-check.v1",
      artifact: "format-conversion-plan-json",
      professionalManifestArtifact: "professional-format-manifest-json",
      modeSeparationStrategy: "human-agent-response-profile-separation.v1",
      professionalFormats: PROFESSIONAL_FORMAT_ORDER,
      formatMatrix: professionalFormatMatrix(PROFESSIONAL_FORMAT_ORDER),
      humanReadableTargets: ["portable-markdown", "portable-docx", "console-summary-json", "workspace-package-zip"],
      agentReadableTargets: ["agent-message-json", "professional-format-manifest-json", "result-json", "evidence-pack-json"],
      preserves: ["routePlan", "parserTrace", "elementRefs", "windowIds", "contentHash", "frontmatter", "codeBlocks", "blockquotes", "page", "bbox", "sheet", "sheetName", "sheetId", "worksheetPath", "definedNames", "namedRanges", "printAreas", "row", "column", "cellRefs", "mergedCells", "cellComments", "dateSerials", "links", "images", "charts", "chartSeries", "formFields", "contentControls", "bookmarks", "headers", "footers", "formulas", "paragraphStyles", "listLevels", "annotations", "revisions", "shapeIds", "shapeNames", "shapeGeometry", "shapeConnectors", "shapePlaceholders", "slide-layout", "slide-master", "slideLayouts", "slideMasters"],
      qualityGates: uniqueOrdered(PROFESSIONAL_FORMAT_ORDER.flatMap((formatId) => (
        professionalFormatAdapter(formatId)?.qualityGates || []
      ))),
      riskControls: uniqueOrdered(PROFESSIONAL_FORMAT_ORDER.flatMap((formatId) => (
        professionalFormatAdapter(formatId)?.riskControls || []
      )))
    },
    runtimeDoctor: runtimeStatus,
    classification: {
      supported: true,
      strategy: CLASSIFICATION_STRATEGY,
      taxonomyStrategy: "semantic-concept-topic-hierarchy.v1",
      assignmentRationaleStrategy: "leader-clustering-semantic-concept-rationale.v1",
      embedding: {
        provider: "builtin:hashing-semantic-v1",
        dimensions: EMBEDDING_DIMENSIONS,
        clusterThreshold: LEADER_CLUSTER_THRESHOLD,
        windowCommunityThreshold: WINDOW_COMMUNITY_CLUSTER_THRESHOLD,
        crossTopicLinkThreshold: CROSS_TOPIC_LINK_THRESHOLD,
        separationThreshold: CLASSIFICATION_SEPARATION_THRESHOLD,
        garbageSignalThreshold: GARBAGE_SIGNAL_THRESHOLD
      },
      referencePatterns: [
        "graphrag.community-reports",
        "llama-index.nodes-with-metadata",
        "haystack.explicit-pipeline-components"
      ],
      purpose: "Separate unrelated source groups before distillation to keep outputs low-coupling and high-cohesion."
    },
    grounding: {
      supported: true,
      strategy: GROUNDING_STRATEGY,
      supportThreshold: GROUNDING_SUPPORT_THRESHOLD,
      conflictThreshold: GROUNDING_CONFLICT_THRESHOLD,
      promotionGate: "claim-grounded-promotion",
      purpose: "Attach generated and requested claims to top-k source evidence, detect cross-topic conflicts, and gate candidate promotion."
    },
    incrementalConvergence: {
      supported: true,
      strategy: INCREMENTAL_CONVERGENCE_STRATEGY,
      projectFields: ["projectId", "workspaceId", "repositoryId", "project.id", "project.name"],
      snapshotFields: ["projectFingerprint", "documents", "windows", "groups"],
      diffFields: ["addedSourceIds", "changedSourceIds", "removedSourceIds", "reusedSourceIds", "reusedWindowCount", "reuseRatio"],
      artifact: "project-snapshot-json",
      referencePatterns: [
        "graphrag.period-size-incremental-merge",
        "graphrag.text-units-community-reports",
        "haystack.pipeline-snapshot",
        "llama-index.ref-doc-hash"
      ]
    },
    graphEvidence: {
      supported: true,
      strategy: GRAPH_EVIDENCE_STRATEGY,
      artifact: "evidence-pack-json",
      tables: ["text_units", "entities", "relationships", "covariates", "communities", "community_reports"],
      query: {
        supported: true,
        strategy: EVIDENCE_QUERY_STRATEGY,
        endpoint: "GET /v1/distillation/runs/:runId/evidence",
        filters: ["entity", "relationship", "claimStatus", "claim", "sourceId", "domain", "routeId", "groupId", "timeFrom", "timeTo", "limit"],
        purpose: "Return a bounded, machine-readable evidence slice for agents instead of forcing full artifact scans."
      },
      projectQuery: {
        supported: true,
        strategy: PROJECT_EVIDENCE_QUERY_STRATEGY,
        endpoint: "GET /v1/projects/:projectId/evidence",
        modes: ["all", "latest"],
        filters: ["mode", "runLimit", "entity", "relationship", "claimStatus", "claim", "sourceId", "domain", "routeId", "groupId", "timeFrom", "timeTo", "limit"],
        readModel: "domain-topic-community-source-time.v1",
        purpose: "Merge graph evidence across runs for the same projectId so agents can query large-project convergence by domain, topic, route, source, or time without downloading every run artifact."
      },
      referencePatterns: [
        "graphrag.text-units-entities-relationships",
        "graphrag.covariates-claims",
        "graphrag.community-reports",
        "llama-index.nodes-with-score",
        "haystack.document-metadata"
      ]
    },
    referenceGapReport: {
      supported: true,
      strategy: REFERENCE_GAP_REPORT_STRATEGY,
      localAuditStrategy: REFERENCE_FRAMEWORK_AUDIT_STRATEGY,
      endpoint: "GET /v1/reference-gap-report",
      artifact: "reference-gap-report-json",
      purpose: "Continuously compare the service against local open-source reference framework checkouts and expose absorbed patterns plus remaining gaps."
    },
    referenceFrameworks: referenceFrameworks
      ? {
          protocolVersion: referenceFrameworks.protocolVersion,
          localRoot: referenceFrameworks.localRoot,
          localAudit: referenceFrameworks.localAudit
            ? {
                strategy: referenceFrameworks.localAudit.strategy,
                generatedAt: referenceFrameworks.localAudit.generatedAt,
                auditCommand: referenceFrameworks.localAudit.auditCommand,
                syncCommand: referenceFrameworks.localAudit.syncCommand,
                expectedCount: referenceFrameworks.localAudit.expectedCount,
                presentCount: referenceFrameworks.localAudit.presentCount,
                gitCheckoutCount: referenceFrameworks.localAudit.gitCheckoutCount,
                commitMatchCount: referenceFrameworks.localAudit.commitMatchCount,
                dirtyCheckoutCount: referenceFrameworks.localAudit.dirtyCheckoutCount,
                missingCount: referenceFrameworks.localAudit.missingCount
              }
            : null,
          count: referenceFrameworks.frameworks.length,
          frameworks: referenceFrameworks.frameworks.map((item) => ({
            id: item.id,
            repo: item.repo,
            localPath: item.localPath,
            commit: item.commit,
            localAudit: referenceFrameworks.localAudit?.frameworks?.find((framework) => framework.id === item.id) || null,
            starsAtSelection: item.starsAtSelection,
            learnFrom: item.learnFrom
          }))
        }
      : null
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
      jsonResponse(response, 200, {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        serviceName: SERVICE_NAME,
        serviceKind: SERVICE_KIND,
        dataDir: DATA_DIR,
        runtimeDoctor: await runtimeDoctor({ force: url.searchParams.get("refresh") === "1" })
      });
      return;
    }

    if (request.method === "GET" && pathname === "/v1/capabilities") {
      jsonResponse(response, 200, capabilities(
        await loadReferenceFrameworks(),
        await runtimeDoctor({ force: url.searchParams.get("refresh") === "1" })
      ));
      return;
    }

    if (request.method === "GET" && pathname === "/v1/runtime/health") {
      jsonResponse(response, 200, await runtimeDoctor({ force: url.searchParams.get("refresh") === "1" }));
      return;
    }

    if (request.method === "GET" && pathname === "/v1/reference-frameworks") {
      jsonResponse(response, 200, await loadReferenceFrameworks());
      return;
    }

    if (request.method === "GET" && pathname === "/v1/reference-gap-report") {
      jsonResponse(response, 200, buildReferenceGapReport(
        await loadReferenceFrameworks(),
        { runtimeStatus: await runtimeDoctor({ force: url.searchParams.get("refresh") === "1" }) }
      ));
      return;
    }

    if (request.method === "GET" && pathname === "/v1/distillation/runs") {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
      const runs = await loadRuns();
      jsonResponse(response, 200, {
        protocolVersion: PROTOCOL_VERSION,
        serviceName: SERVICE_NAME,
        serviceKind: SERVICE_KIND,
        runs: runs.slice(-limit).reverse().map(compactRun)
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/distillation/runs") {
      const body = await readJson(request);
      const runs = await loadRuns();
      const run = await createRun(body, await runtimeDoctor(), runs, await loadReferenceFrameworks());
      runs.push(run);
      await saveRuns(runs);
      jsonResponse(response, 201, run);
      return;
    }

    const projectEvidenceMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/evidence$/);
    if (request.method === "GET" && projectEvidenceMatch) {
      const projectId = decodeURIComponent(projectEvidenceMatch[1]);
      const runs = await loadRuns();
      const query = normalizeProjectEvidenceQuery(url.searchParams);
      const projectEvidence = buildProjectEvidenceQueryResult({ projectId, runs, query });
      if (projectEvidence.totalMatchedRunCount === 0) {
        jsonResponse(response, 404, {
          error: "external distillation project evidence not found",
          projectId,
          strategy: PROJECT_EVIDENCE_QUERY_STRATEGY
        });
        return;
      }
      jsonResponse(response, 200, projectEvidence);
      return;
    }

    const runMatch = pathname.match(/^\/v1\/distillation\/runs\/([^/]+)(?:\/(.+))?$/);
    if (runMatch) {
      const runId = decodeURIComponent(runMatch[1]);
      const suffix = runMatch[2] || "";
      const runs = await loadRuns();
      const run = runs.find((item) => item.runId === runId);
      if (!run) {
        jsonResponse(response, 404, { error: "external distillation run not found", runId });
        return;
      }

      if (request.method === "GET" && !suffix) {
        jsonResponse(response, 200, run);
        return;
      }

      if (request.method === "POST" && suffix === "cancel") {
        run.status = run.status === "completed" ? "completed" : "canceled";
        run.updatedAt = nowIso();
        await saveRuns(runs);
        jsonResponse(response, 202, run);
        return;
      }

      if (request.method === "GET" && suffix === "evidence") {
        jsonResponse(response, 200, buildEvidenceQueryResult({
          runId,
          graphEvidence: run.result?.graphEvidence || {},
          filters: normalizeEvidenceQuery(url.searchParams)
        }));
        return;
      }

      const artifactMatch = suffix.match(/^artifacts\/([^/]+)$/);
      if (request.method === "GET" && artifactMatch) {
        const artifactId = decodeURIComponent(artifactMatch[1]);
        if (artifactId === "portable-markdown") {
          const markdown = run.result?.portableDocuments?.[0]?.document?.markdown || "";
          textResponse(response, 200, markdown, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="${run.runId}.md"`
          });
          return;
        }
        if (artifactId === "portable-docx") {
          binaryResponse(response, 200, buildPortableDocx(run), {
            "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content-disposition": `attachment; filename="${run.runId}.docx"`
          });
          return;
        }
        if (artifactId === "console-summary-json") {
          jsonResponse(response, 200, buildConsoleSummary(run), {
            "content-disposition": `attachment; filename="${run.runId}.console-summary.json"`
          });
          return;
        }
        if (artifactId === "result-json") {
          jsonResponse(response, 200, run, {
            "content-disposition": `attachment; filename="${run.runId}.json"`
          });
          return;
        }
        if (artifactId === "agent-message-json") {
          jsonResponse(response, 200, run.result?.agentMessage || {}, {
            "content-disposition": `attachment; filename="${run.runId}.agent.json"`
          });
          return;
        }
        if (artifactId === "project-snapshot-json") {
          jsonResponse(response, 200, run.result?.incrementalPlan || {}, {
            "content-disposition": `attachment; filename="${run.runId}.project-snapshot.json"`
          });
          return;
        }
        if (artifactId === "evidence-pack-json") {
          jsonResponse(response, 200, run.result?.graphEvidence || {}, {
            "content-disposition": `attachment; filename="${run.runId}.evidence-pack.json"`
          });
          return;
        }
        if (artifactId === "format-conversion-plan-json") {
          jsonResponse(response, 200, run.result?.formatConversionPlan || {}, {
            "content-disposition": `attachment; filename="${run.runId}.format-conversion-plan.json"`
          });
          return;
        }
        if (artifactId === "professional-format-manifest-json") {
          jsonResponse(response, 200, buildProfessionalFormatManifest(run), {
            "content-disposition": `attachment; filename="${run.runId}.professional-format-manifest.json"`
          });
          return;
        }
        if (artifactId === "reference-gap-report-json") {
          jsonResponse(response, 200, run.result?.referenceGapReport || {}, {
            "content-disposition": `attachment; filename="${run.runId}.reference-gap-report.json"`
          });
          return;
        }
        if (artifactId === "workspace-package-zip") {
          binaryResponse(response, 200, buildWorkspacePackageZip(run), {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${run.runId}.workspace-package.zip"`
          });
          return;
        }
        jsonResponse(response, 404, { error: "external distillation artifact not found", runId, artifactId });
        return;
      }
    }

    jsonResponse(response, 404, { error: "not found", path: pathname });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    jsonResponse(response, statusCode >= 400 && statusCode < 600 ? statusCode : 500, {
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "EXTERNAL_DISTILLATION_ERROR"
    });
  }
}

await fs.mkdir(DATA_DIR, { recursive: true });

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`${SERVICE_NAME} listening on http://${HOST}:${PORT}`);
});
