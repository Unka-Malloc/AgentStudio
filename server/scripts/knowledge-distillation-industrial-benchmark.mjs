import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serviceRoot = path.join(repoRoot, "external-services/knowledge-distillation-service");
const referenceManifestPath = path.join(serviceRoot, "reference-frameworks.json");
const serviceServerPath = path.join(serviceRoot, "server.mjs");

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

async function buildExternalIndustrialBenchmark() {
  const [manifest, serviceText] = await Promise.all([
    readJson(referenceManifestPath),
    fs.readFile(serviceServerPath, "utf8")
  ]);
  const frameworks = Array.isArray(manifest.frameworks) ? manifest.frameworks : [];
  const frameworkIds = frameworks.map((framework) => String(framework.id || ""));
  const absorbedPatterns = [
    "routePlan",
    "graphEvidence",
    "referenceGapReport",
    "hashing_embedding_window_community_classification_v3",
    "hierarchical-domain-topic-project-convergence.v3",
    "human-agent-response-profile-separation.v1",
    "professional-format-manifest-json",
    "office-document-professional-adaptation.v1",
    "directory-file-ref-recursive-routing.v1",
    "PROJECT_EVIDENCE_QUERY_STRATEGY"
  ];
  const localCheckoutCount = frameworks.filter((framework) => framework.localPath).length;
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
    absorbedPatterns,
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
      mountedProjectDirectoryExpansion: hasAll(serviceText, [
        "directory-file-ref-recursive-routing.v1",
        "directory.file-ref.expand",
        "directory.entry-file-ref"
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
