import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serviceRoot = path.join(repoRoot, "external-services/knowledge-distillation-service");
const referenceManifestPath = path.join(serviceRoot, "reference-frameworks.json");
const serviceServerPath = path.join(serviceRoot, "server.mjs");
const serviceConfigPaths = Object.freeze([
  path.join(serviceRoot, "format-routes.json"),
  path.join(serviceRoot, "parser-strategies.json"),
  path.join(serviceRoot, "format-conversion-profiles.json"),
  path.join(serviceRoot, "model-distillation-profiles.json")
]);

const REFERENCE_SOURCE_MARKERS = Object.freeze({
  ragflow: {
    requiredPaths: ["deepdoc/parser", "rag/graphrag", "agent"],
    absorbedCapabilities: ["route-first document understanding", "large project artifact package", "agent-readable knowledge-base flow"]
  },
  mineru: {
    requiredPaths: ["mineru/backend/office", "mineru/model/ocr", "mineru/model/table", "mineru/model/docx", "mineru/model/pptx", "mineru/model/xlsx"],
    absorbedCapabilities: ["complex PDF parsing", "office document conversion", "LLM-ready Markdown/JSON outputs"]
  },
  docling: {
    requiredPaths: ["docling/backend/docx", "docling/backend/xml", "docling/chunking", "docling/datamodel", "tests/data/pdf", "tests/data/xlsx", "tests/data/pptx"],
    absorbedCapabilities: ["unified document model", "layout/table/formula extraction", "document-element-model.v1"]
  },
  "llama-index": {
    requiredPaths: ["llama-index-core", "docs/examples/agent", "docs/examples/graph_rag", "docs/examples/node_parsers", "docs/examples/evaluation"],
    absorbedCapabilities: ["document agents", "nodes-with-metadata", "retrieval/evaluation patterns"]
  },
  marker: {
    requiredPaths: ["marker/converters", "marker/renderers", "marker/schema", "marker/processors", "data/examples/markdown", "data/examples/json"],
    absorbedCapabilities: ["PDF to markdown/json", "portable Markdown output", "DOCX and workspace ZIP packaging"]
  },
  graphrag: {
    requiredPaths: ["packages/graphrag", "packages/graphrag-chunking", "packages/graphrag-storage", "packages/graphrag-input", "tests/unit/indexing", "tests/unit/query"],
    absorbedCapabilities: ["text_units/entities/relationships", "community reports", "large corpus convergence"]
  },
  haystack: {
    requiredPaths: ["haystack/core/pipeline", "haystack/components/converters", "haystack/components/routers", "haystack/components/evaluators", "test/components/converters"],
    absorbedCapabilities: ["explicit pipeline components", "component orchestration", "evaluation patterns"]
  },
  unstructured: {
    requiredPaths: ["unstructured/partition", "unstructured/partition/pdf_image", "unstructured/chunking", "unstructured/documents", "unstructured/file_utils"],
    absorbedCapabilities: ["partition-style format routing", "chunk_by_title", "element-type enrichment"]
  }
});

const ABSORPTION_REQUIREMENTS = Object.freeze([
  {
    capability: "DocumentParsing",
    references: ["docling", "mineru", "unstructured", "haystack"],
    servicePatterns: [
      "DOCUMENT_PARSING_MODULE_BOUNDARY",
      "document-element-model.v1",
      "element-aware-by-title-windowing.v1",
      "content-signature-routing.v1",
      "singleton-format-route-registry.v1",
      "singleton-parser-strategy-registry.v1"
    ]
  },
  {
    capability: "ProfessionalOfficeCompatibility",
    references: ["docling", "mineru", "marker", "unstructured"],
    servicePatterns: [
      "office.word.structured",
      "office.presentation.slides",
      "table.sheet.structured",
      "office-document-professional-adaptation.v1",
      "singleton-format-conversion-profile-registry.v1",
      "format-conversion-output-artifact-self-check.v1"
    ]
  },
  {
    capability: "AllSizeProcessing",
    references: ["ragflow", "haystack", "unstructured"],
    servicePatterns: [
      "streaming-windowed",
      "input.manifest.jsonl",
      "payload.stream-text",
      "single-node-background-run-queue.v1",
      "directory-file-ref-recursive-routing.v1",
      "structured-zip-entry-bounded-or-streaming.v1"
    ]
  },
  {
    capability: "ClassificationDistillation",
    references: ["graphrag", "llama-index", "haystack"],
    servicePatterns: [
      "hashing_embedding_window_community_classification_v3",
      "semantic-concept-topic-hierarchy.v1",
      "leader-clustering-semantic-concept-rationale.v1",
      "lowCouplingHighCohesion",
      "distillationUnit",
      "profile-guided-group-distillation-map.v1"
    ]
  },
  {
    capability: "ProjectConvergenceGraphEvidence",
    references: ["graphrag", "ragflow", "llama-index"],
    servicePatterns: [
      "hierarchical-domain-topic-project-convergence.v3",
      "graph-lite-entity-relationship-evidence-pack.v1",
      "community_reports",
      "PROJECT_EVIDENCE_QUERY_STRATEGY",
      "project-snapshot-incremental-convergence.v1"
    ]
  },
  {
    capability: "HumanAgentApiSeparation",
    references: ["llama-index", "marker", "ragflow"],
    servicePatterns: [
      "human-agent-response-profile-separation.v1",
      "console-summary-json",
      "agent-message-json",
      "professional-format-manifest-json"
    ]
  },
  {
    capability: "RealModelDistillation",
    references: ["haystack", "llama-index", "ragflow"],
    servicePatterns: [
      "MODEL_DISTILLATION_MODULE_BOUNDARY",
      "required-agent-gateway-real-model-call.v1",
      "singleton-model-distillation-profile-registry.v1",
      "MODEL_GATEWAY_REQUIRED",
      "MODEL_ALIAS_REQUIRED"
    ]
  }
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    output: "",
    pretty: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];
    if (item === "--output" || item === "-o") {
      args.output = next || "";
      index += 1;
    } else if (item === "--compact") {
      args.pretty = false;
    } else if (item === "--help" || item === "-h") {
      args.help = true;
    }
  }
  return args;
}

function helpText() {
  return `
Usage:
  node server/scripts/knowledge-distillation-industrial-benchmark.mjs --output /tmp/external-kd-industrial.json

This command audits the maintained external.knowledge.distillation service against local reference framework checkouts.
The embedded platform knowledge-distillation runtime has been removed from the maintained path.
`.trim();
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function hasAll(text, patterns = []) {
  return patterns.every((pattern) => text.includes(pattern));
}

function runGit(args = [], cwd = repoRoot) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim()
  };
}

function resolveLocalPath(localPath = "") {
  const value = String(localPath || "").trim();
  if (!value) {
    return "";
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function gitReferenceAudit(framework = {}) {
  const resolvedPath = resolveLocalPath(framework.localPath);
  const exists = Boolean(resolvedPath && fsSync.existsSync(resolvedPath));
  const gitPresent = exists && fsSync.existsSync(path.join(resolvedPath, ".git"));
  const head = gitPresent ? runGit(["-C", resolvedPath, "rev-parse", "--short", "HEAD"]) : { status: 1, stdout: "" };
  const status = gitPresent ? runGit(["-C", resolvedPath, "status", "--short", "--untracked-files=no"]) : { status: 1, stdout: "" };
  const actualCommit = head.status === 0 ? head.stdout : "";
  const manifestCommit = String(framework.commit || "").trim();
  const dirtyFileCount = status.status === 0 && status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean).length : 0;
  const markers = REFERENCE_SOURCE_MARKERS[framework.id] || { requiredPaths: [], absorbedCapabilities: [] };
  const sourceEvidence = markers.requiredPaths.map((relativePath) => {
    const absolutePath = path.join(resolvedPath, relativePath);
    return {
      path: relativePath,
      exists: fsSync.existsSync(absolutePath)
    };
  });
  return {
    id: framework.id,
    name: framework.name,
    repo: framework.repo,
    url: framework.url,
    localPath: framework.localPath,
    resolvedPath,
    manifestCommit,
    actualCommit,
    exists,
    gitPresent,
    commitMatches: Boolean(manifestCommit && actualCommit && actualCommit.startsWith(manifestCommit)),
    dirtyFileCount,
    sourceEvidence,
    sourceEvidencePassed: sourceEvidence.length > 0 && sourceEvidence.every((item) => item.exists),
    absorbedCapabilities: markers.absorbedCapabilities
  };
}

function buildAbsorptionMatrix(serviceText = "", referenceAudits = []) {
  const auditById = new Map(referenceAudits.map((audit) => [audit.id, audit]));
  return ABSORPTION_REQUIREMENTS.map((requirement) => {
    const referenceEvidence = requirement.references.map((id) => {
      const audit = auditById.get(id);
      return {
        id,
        present: Boolean(audit?.exists),
        commitMatches: Boolean(audit?.commitMatches),
        sourceEvidencePassed: Boolean(audit?.sourceEvidencePassed)
      };
    });
    const serviceEvidence = requirement.servicePatterns.map((pattern) => ({
      pattern,
      present: serviceText.includes(pattern)
    }));
    return {
      capability: requirement.capability,
      references: requirement.references,
      servicePatterns: requirement.servicePatterns,
      referenceEvidence,
      serviceEvidence,
      status: referenceEvidence.every((item) => item.present && item.commitMatches && item.sourceEvidencePassed) &&
        serviceEvidence.every((item) => item.present)
        ? "absorbed"
        : "incomplete"
    };
  });
}

async function buildExternalIndustrialBenchmark() {
  const [manifest, serviceSourceText, ...serviceConfigTexts] = await Promise.all([
    readJson(referenceManifestPath),
    fs.readFile(serviceServerPath, "utf8"),
    ...serviceConfigPaths.map((configPath) => fs.readFile(configPath, "utf8"))
  ]);
  const serviceText = [serviceSourceText, ...serviceConfigTexts].join("\n");
  const frameworks = Array.isArray(manifest.frameworks) ? manifest.frameworks : [];
  const frameworkIds = frameworks.map((framework) => String(framework.id || ""));
  const referenceAudits = frameworks.map(gitReferenceAudit);
  const absorptionMatrix = buildAbsorptionMatrix(serviceText, referenceAudits);
  const absorbedPatterns = [
    "routePlan",
    "graphEvidence",
    "referenceGapReport",
    "hashing_embedding_window_community_classification_v3",
    "hierarchical-domain-topic-project-convergence.v3",
    "human-agent-response-profile-separation.v1",
    "professional-format-manifest-json",
    "office-document-professional-adaptation.v1",
    "singleton-format-conversion-profile-registry.v1",
    "profile-guided-group-distillation-map.v1",
    "visio-opc-shape-parser.v1",
    "directory-file-ref-recursive-routing.v1",
    "PROJECT_EVIDENCE_QUERY_STRATEGY",
    "required-agent-gateway-real-model-call.v1",
    "singleton-model-distillation-profile-registry.v1"
  ];
  const localCheckoutCount = frameworks.filter((framework) => framework.localPath).length;
  const referenceAuditSummary = {
    expectedCount: referenceAudits.length,
    presentCount: referenceAudits.filter((audit) => audit.exists).length,
    gitCheckoutCount: referenceAudits.filter((audit) => audit.gitPresent).length,
    commitMatchCount: referenceAudits.filter((audit) => audit.commitMatches).length,
    cleanCheckoutCount: referenceAudits.filter((audit) => audit.dirtyFileCount === 0).length,
    sourceEvidencePassCount: referenceAudits.filter((audit) => audit.sourceEvidencePassed).length
  };
  return {
    protocolVersion: "pact.external-knowledge-distillation.industrial-benchmark.v1",
    service: "external.knowledge.distillation",
    generatedAt: new Date().toISOString(),
    referenceManifest: {
      protocolVersion: manifest.protocolVersion || "",
      localRoot: manifest.localRoot || "",
      frameworkCount: frameworks.length,
      localCheckoutCount,
      frameworkIds
    },
    referenceAudit: {
      strategy: "manifest-pinned-local-source-evidence.v1",
      summary: referenceAuditSummary,
      frameworks: referenceAudits
    },
    absorbedPatterns,
    absorptionMatrix,
    checks: {
      referenceFrameworksPresent: hasAll(frameworkIds.join("\n"), [
        "ragflow",
        "mineru",
        "docling",
        "llama-index",
        "marker",
        "graphrag",
        "haystack",
        "unstructured"
      ]),
      referenceCheckoutsPinned: referenceAuditSummary.commitMatchCount === referenceAuditSummary.expectedCount,
      referenceSourceEvidence: referenceAuditSummary.sourceEvidencePassCount === referenceAuditSummary.expectedCount,
      referenceAbsorptionMatrix: absorptionMatrix.every((item) => item.status === "absorbed"),
      externalServiceOnly: !serviceText.includes("createKnowledgeDistillationRuntime"),
      routeWindowClassification: hasAll(serviceText, [
        "routePlan",
        "window",
        "classification",
        "distillationUnit"
      ]),
      graphConvergence: hasAll(serviceText, [
        "graphEvidence",
        "community_reports",
        "PROJECT_EVIDENCE_QUERY_STRATEGY"
      ]),
      humanAgentSeparation: hasAll(serviceText, [
        "console-summary-json",
        "agent-message-json",
        "human-agent-response-profile-separation.v1"
      ]),
      professionalOfficeAdaptation: hasAll(serviceText, [
        "office-document-professional-adaptation.v1",
        "professional-format-manifest-json",
        "format-conversion-plan-json"
      ]),
      officeVisioAdaptation: hasAll(serviceText, [
        "visio-opc-shape-parser.v1",
        "office.visio.pages",
        "office.visio.connectors",
        "visio-opc-page-shape-route"
      ]),
      mountedProjectDirectoryExpansion: hasAll(serviceText, [
        "directory-file-ref-recursive-routing.v1",
        "directory.file-ref.expand",
        "directory.entry-file-ref"
      ]),
      realModelDistillation: hasAll(serviceText, [
        "MODEL_DISTILLATION_MODULE_BOUNDARY",
        "required-agent-gateway-real-model-call.v1",
        "MODEL_GATEWAY_REQUIRED",
        "MODEL_ALIAS_REQUIRED"
      ])
    }
  };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(helpText());
    return;
  }
  const benchmark = await buildExternalIndustrialBenchmark();
  const json = `${JSON.stringify(benchmark, null, args.pretty ? 2 : 0)}\n`;
  if (args.output) {
    const outputPath = path.resolve(args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, json, "utf8");
    console.log(`external knowledge distillation industrial benchmark written: ${outputPath}`);
    return;
  }
  process.stdout.write(json);
}

await main();
