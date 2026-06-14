import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../config/ServerConfig.mjs";
import { pathToFileURL } from "node:url";

export const MODULE_ECOSYSTEM_PROTOCOL_VERSION = "v0.0.1:tool:module-ecosystem-1";
export const MOUNT_MODULE_PROTOCOL_VERSION = "v0.0.1:tool:mount-module-1";

const MOUNT_TEMPLATE_IDS = new Set([
  "documentParser",
  "analysis",
  "knowledgeBase",
  "vectorStore",
  "graphStore",
  "customMount"
]);

const TEMPLATE_DEFINITIONS = Object.freeze({
  documentParser: {
    templateId: "documentParser",
    kind: "mount",
    mountName: "documentParser",
    title: "Document parser mount",
    description: "Extracts text, metadata, and embedded documents for routed source files.",
    capabilities: ["supports", "extractDocument", "extractText", "reload", "close"],
    defaultExtensions: [".txt", ".md"]
  },
  analysis: {
    templateId: "analysis",
    kind: "mount",
    mountName: "analysis",
    title: "Analysis mount",
    description: "Lists analysis modules and runs custom analysis over sources and chunks.",
    capabilities: ["listModules", "listAlgorithms", "runAnalysis", "onBatchCompleted", "reload", "close"],
    defaultExtensions: []
  },
  knowledgeBase: {
    templateId: "knowledgeBase",
    kind: "mount",
    mountName: "knowledgeBase",
    title: "Knowledge base mount",
    description: "Implements external evidence search and evidence read contracts.",
    capabilities: ["search", "readEvidence", "onBatchCompleted", "reload", "close"],
    defaultExtensions: []
  },
  vectorStore: {
    templateId: "vectorStore",
    kind: "mount",
    mountName: "vectorStore",
    title: "Vector store mount",
    description: "Synchronizes chunks into an external vector index and serves similarity queries.",
    capabilities: ["upsertVectors", "queryVectors", "onBatchCompleted", "reload", "close"],
    defaultExtensions: []
  },
  graphStore: {
    templateId: "graphStore",
    kind: "mount",
    mountName: "graphStore",
    title: "Graph store mount",
    description: "Synchronizes entities and edges into an external graph index.",
    capabilities: ["upsertGraph", "queryGraph", "onBatchCompleted", "reload", "close"],
    defaultExtensions: []
  },
  customMount: {
    templateId: "customMount",
    kind: "mount",
    mountName: "customMount",
    title: "Custom mount",
    description: "Creates a named custom mount for routed source-code agents or domain adapters.",
    capabilities: ["supports", "extractDocument", "extractText", "onBatchCompleted", "reload", "close"],
    defaultExtensions: []
  },
  toolPackage: {
    templateId: "toolPackage",
    kind: "capabilityPackage",
    packageKind: "tool",
    title: "Tool package",
    description: "Defines a signed Tool Management package manifest and CI validation shell.",
    capabilities: ["execute", "policyPreview", "audit"],
    defaultExtensions: []
  },
  skillPackage: {
    templateId: "skillPackage",
    kind: "capabilityPackage",
    packageKind: "skill",
    title: "Skill package",
    description: "Defines a reusable KnowledgeSkill package manifest and evidence reference shell.",
    capabilities: ["plan", "run", "evaluate"],
    defaultExtensions: []
  }
});

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeIdentifier(value, fallback = "pact.module") {
  const normalized = normalizeText(value || fallback);
  return normalized || fallback;
}

function safeName(value, fallback = "pact-module") {
  return normalizeIdentifier(value, fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function listTemplateDefinitions() {
  return Object.values(TEMPLATE_DEFINITIONS).map((template) => ({
    protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    templateId: template.templateId,
    kind: template.kind,
    mountName: template.mountName || "",
    packageKind: template.packageKind || "",
    title: template.title,
    description: template.description,
    capabilities: [...template.capabilities],
    defaultExtensions: [...template.defaultExtensions]
  }));
}

export function listModuleTemplates() {
  return {
    protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    templates: listTemplateDefinitions()
  };
}

function resolveTemplate(input = {}) {
  const templateId = normalizeText(input.templateId || input.template || input.kind || "documentParser");
  const template = TEMPLATE_DEFINITIONS[templateId];
  if (!template) {
    const error = new Error(`Unknown module template: ${templateId}`);
    error.details = listTemplateDefinitions().map((item) => item.templateId);
    throw error;
  }
  return template;
}

function normalizeScaffoldRequest(input = {}, { userDataPath = "" } = {}) {
  const source = asObject(input);
  const template = resolveTemplate(source);
  const moduleId = normalizeIdentifier(source.moduleId || source.name, `external.${template.templateId}`);
  const selectedSafeName = safeName(source.safeName || moduleId);
  const targetDir = path.resolve(
    normalizeText(source.targetDir || source.outputDir || source.dir) ||
      path.join(userDataPath || ServerConfig.getDataDir(), "module-ecosystem", "scaffolds", selectedSafeName)
  );
  return {
    protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    template,
    moduleId,
    safeName: selectedSafeName,
    targetDir,
    packageName: normalizeText(source.packageName) || `@pact-module/${selectedSafeName}`,
    title: normalizeText(source.title) || template.title,
    description: normalizeText(source.description) || template.description,
    owner: normalizeText(source.owner) || "external",
    version: normalizeText(source.version) || "0.0.1",
    license: normalizeText(source.license) || "UNLICENSED",
    mountName: normalizeText(source.mountName) || template.mountName || selectedSafeName,
    force: bool(source.force, false),
    includeCi: source.includeCi === undefined ? true : bool(source.includeCi, true),
    metadata: asObject(source.metadata)
  };
}

function moduleManifest(request) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: MOUNT_MODULE_PROTOCOL_VERSION,
    ecosystemProtocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    moduleId: request.moduleId,
    templateId: request.template.templateId,
    kind: request.template.kind,
    mountName: request.mountName,
    version: request.version,
    title: request.title,
    description: request.description,
    owner: request.owner,
    license: request.license,
    entrypoint: "index.mjs",
    capabilities: [...request.template.capabilities],
    contract: {
      factoryExports: ["createMount", "default", `create${request.mountName.slice(0, 1).toUpperCase()}${request.mountName.slice(1)}Mount`],
      factoryInput: ["mountName", "userDataPath", "runtimeOptions"],
      contractTest: "npm run contract:test"
    },
    routing: {
      mountName: request.mountName,
      extensions: [...request.template.defaultExtensions]
    },
    ci: request.includeCi ? {
      workflow: ".github/workflows/contract-test.yml",
      required: true
    } : null,
    metadata: request.metadata
  };
}

function capabilityPackageManifest(request) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    ecosystemProtocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    kind: request.template.packageKind,
    name: request.safeName,
    version: request.version,
    title: request.title,
    description: request.description,
    owner: request.owner,
    source: "external",
    capabilities: [...request.template.capabilities],
    risk: request.template.packageKind === "tool" ? "safe_write" : "read_only",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    secretRefs: [],
    dependencies: [],
    compatibility: {
      minServerVersion: "",
      featureIds: request.template.packageKind === "tool"
        ? ["tool-management"]
        : ["knowledge-skill-runtime"],
      platforms: ["server"]
    },
    sandbox: {
      policy: request.template.packageKind === "tool" ? "server-runtime" : "knowledge-only",
      network: false,
      filesystem: "package",
      commands: []
    },
    license: request.license,
    signature: {
      required: false,
      algorithm: "sha256",
      digestSha256: ""
    },
    metadata: request.metadata
  };
}

function packageJson(request) {
  return {
    name: request.packageName,
    version: request.version,
    private: true,
    type: "module",
    scripts: {
      "contract:test": request.template.kind === "mount"
        ? "node scripts/contract-test.mjs"
        : "node scripts/validate-manifest.mjs"
    },
    pact: {
      protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
      templateId: request.template.templateId,
      moduleId: request.moduleId
    }
  };
}

function sampleText(request) {
  return [
    `# ${request.title}`,
    "",
    "This sample file is used by the Pact module contract test.",
    `moduleId: ${request.moduleId}`,
    `templateId: ${request.template.templateId}`
  ].join("\n");
}

function mountIndexSource(request) {
  return `import fs from "node:fs/promises";

export function createMount({ mountName = ${JSON.stringify(request.mountName)}, userDataPath = "", runtimeOptions = {} } = {}) {
  const state = {
    reloaded: false,
    closed: false
  };
  return {
    id: ${JSON.stringify(request.moduleId)},
    kind: mountName,
    enabled: true,
    protocolVersion: ${JSON.stringify(MOUNT_MODULE_PROTOCOL_VERSION)},

    supports({ extension = "", mediaTypeHint = "", sourceKind = "" } = {}) {
      void mediaTypeHint;
      void sourceKind;
      const supportedExtensions = ${JSON.stringify(request.template.defaultExtensions)};
      return supportedExtensions.length === 0 || supportedExtensions.includes(String(extension || "").toLowerCase());
    },

    async extractDocument({ filePath = "", fileName = "", buffer = null } = {}) {
      const text = buffer
        ? Buffer.from(buffer).toString("utf8")
        : filePath
          ? await fs.readFile(filePath, "utf8").catch(() => "")
          : "";
      return {
        parserId: ${JSON.stringify(request.moduleId)},
        protocolVersion: ${JSON.stringify(MOUNT_MODULE_PROTOCOL_VERSION)},
        mediaType: "",
        metadata: {
          fileName,
          filePath,
          moduleId: ${JSON.stringify(request.moduleId)}
        },
        text,
        embeddedDocuments: []
      };
    },

    async extractText(input = {}) {
      const document = await this.extractDocument(input);
      return document.text || "";
    },

    async listModules() {
      return [{ id: ${JSON.stringify(request.moduleId)}, title: ${JSON.stringify(request.title)} }];
    },

    async listAlgorithms() {
      return [{ id: "default", title: "Default analysis" }];
    },

    async runAnalysis({ sources = [], chunks = [] } = {}) {
      return {
        protocolVersion: ${JSON.stringify(MOUNT_MODULE_PROTOCOL_VERSION)},
        moduleId: ${JSON.stringify(request.moduleId)},
        summary: "analysis completed",
        sourceCount: sources.length,
        chunkCount: chunks.length
      };
    },

    async search({ query = "", limit = 10 } = {}) {
      return {
        query,
        results: [],
        limit
      };
    },

    async readEvidence({ evidenceId = "" } = {}) {
      return {
        evidenceId,
        text: "",
        citations: []
      };
    },

    async upsertVectors({ chunks = [] } = {}) {
      return { indexed: chunks.length };
    },

    async queryVectors({ query = "", limit = 10 } = {}) {
      return { query, results: [], limit };
    },

    async upsertGraph({ nodes = [], edges = [] } = {}) {
      return { nodeCount: nodes.length, edgeCount: edges.length };
    },

    async queryGraph({ seed = "", limit = 10 } = {}) {
      return { seed, nodes: [], edges: [], limit };
    },

    async onBatchCompleted({ batchId = "", jobId = "", result = {} } = {}) {
      void userDataPath;
      void runtimeOptions;
      return {
        batchId,
        jobId,
        observedSources: Array.isArray(result.sourceFiles) ? result.sourceFiles.length : 0
      };
    },

    async reload() {
      state.reloaded = true;
      return { reloaded: true };
    },

    async close() {
      state.closed = true;
    }
  };
}

export default createMount;
`;
}

function localContractScriptSource(request) {
  return `#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.PACT_REPO || path.resolve(__dirname, "../../..");
const { runModuleContractTest } = await import(pathToFileURL(path.join(repoRoot, "server/platform/common/module-manager/module-ecosystem/index.mjs")).href);
const report = await runModuleContractTest({
  modulePath: path.resolve(__dirname, "../index.mjs"),
  mountName: ${JSON.stringify(request.mountName)},
  samplePath: path.resolve(__dirname, "../samples/sample.txt")
});
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exit(1);
}
`;
}

function manifestValidationScriptSource() {
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
const manifest = JSON.parse(await fs.readFile(new URL("../capability-package.json", import.meta.url), "utf8"));
const missing = ["kind", "name", "version", "capabilities", "license"].filter((field) => !manifest[field] || (Array.isArray(manifest[field]) && manifest[field].length === 0));
if (missing.length > 0) {
  console.error("Missing required fields:", missing.join(", "));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, kind: manifest.kind, name: manifest.name, version: manifest.version }, null, 2));
`;
}

function ciWorkflowSource(request) {
  const command = request.template.kind === "mount" ? "npm run contract:test" : "npm run contract:test";
  return `name: Pact module contract

on:
  pull_request:
  push:

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Checkout Pact contract runtime
        uses: actions/checkout@v4
        with:
          repository: Unka-Malloc/Pact
          path: pact
      - run: npm install --ignore-scripts
      - run: ${command}
        env:
          PACT_REPO: \${{ github.workspace }}/pact
`;
}

function readmeSource(request) {
  const command = request.template.kind === "mount"
    ? `npm run contract:test`
    : `npm run contract:test`;
  return `# ${request.title}

Generated for Pact module ecosystem.

- Protocol: \`${MODULE_ECOSYSTEM_PROTOCOL_VERSION}\`
- Template: \`${request.template.templateId}\`
- Module ID: \`${request.moduleId}\`
- Runtime kind: \`${request.template.kind}\`

## Validate

\`\`\`bash
${command}
\`\`\`
`;
}

function scaffoldFiles(request) {
  const files = [
    {
      path: "package.json",
      purpose: "Node package metadata and local validation scripts.",
      content: json(packageJson(request))
    },
    {
      path: "README.md",
      purpose: "Author-facing module instructions.",
      content: readmeSource(request)
    }
  ];

  if (request.template.kind === "mount") {
    files.push(
      {
        path: "module.json",
        purpose: "Pact mount module manifest.",
        content: json(moduleManifest(request))
      },
      {
        path: "index.mjs",
        purpose: "Mount factory implementation.",
        content: mountIndexSource(request)
      },
      {
        path: "samples/sample.txt",
        purpose: "Contract-test sample input.",
        content: `${sampleText(request)}\n`
      },
      {
        path: "scripts/contract-test.mjs",
        purpose: "Local module contract test entrypoint.",
        content: localContractScriptSource(request)
      }
    );
  } else {
    files.push(
      {
        path: "capability-package.json",
        purpose: "Capability package lifecycle manifest.",
        content: json(capabilityPackageManifest(request))
      },
      {
        path: "scripts/validate-manifest.mjs",
        purpose: "Local manifest validation entrypoint.",
        content: manifestValidationScriptSource()
      }
    );
  }

  if (request.includeCi) {
    files.push({
      path: ".github/workflows/contract-test.yml",
      purpose: "CI template for module contract validation.",
      content: ciWorkflowSource(request)
    });
  }
  return files;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function planModuleScaffold(input = {}, options = {}) {
  const request = normalizeScaffoldRequest(input, options);
  const files = await Promise.all(
    scaffoldFiles(request).map(async (file) => {
      const absolutePath = path.join(request.targetDir, file.path);
      const exists = await fileExists(absolutePath);
      return {
        path: file.path,
        absolutePath,
        purpose: file.purpose,
        exists,
        action: exists && !request.force ? "conflict" : exists ? "overwrite" : "create"
      };
    })
  );
  return {
    protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    moduleId: request.moduleId,
    template: listTemplateDefinitions().find((item) => item.templateId === request.template.templateId),
    targetDir: request.targetDir,
    force: request.force,
    files,
    commands: request.template.kind === "mount"
      ? [
          `node server/scripts/pact-create-module.mjs --template ${request.template.templateId} --module-id ${request.moduleId} --target ${request.targetDir}`,
          `node server/scripts/pact-module-contract-test.mjs --module ${path.join(request.targetDir, "index.mjs")} --mount-name ${request.mountName} --sample ${path.join(request.targetDir, "samples/sample.txt")}`
        ]
      : [
          `node server/scripts/pact-create-module.mjs --template ${request.template.templateId} --module-id ${request.moduleId} --target ${request.targetDir}`,
          `node ${path.join(request.targetDir, "scripts/validate-manifest.mjs")}`
        ]
  };
}

export async function scaffoldModule(input = {}, options = {}) {
  const request = normalizeScaffoldRequest(input, options);
  const plan = await planModuleScaffold(input, options);
  const conflicts = plan.files.filter((file) => file.action === "conflict");
  if (conflicts.length > 0) {
    const error = new Error("Module scaffold target has existing files. Pass force=true to overwrite.");
    error.details = conflicts;
    throw error;
  }

  for (const file of scaffoldFiles(request)) {
    const absolutePath = path.join(request.targetDir, file.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, "utf8");
  }

  return {
    ...plan,
    written: plan.files.map((file) => ({
      ...file,
      action: file.exists ? "overwrite" : "create"
    }))
  };
}

async function loadMount({ modulePath, mountName, userDataPath = "", runtimeOptions = {} } = {}) {
  const resolvedPath = path.resolve(String(modulePath || ""));
  const moduleUrl = new URL(pathToFileURL(resolvedPath).href);
  moduleUrl.searchParams.set("contract_test", String(Date.now()));
  const loaded = await import(moduleUrl.href);
  const factory =
    loaded.createMount ||
    loaded.default ||
    loaded[`create${mountName.slice(0, 1).toUpperCase()}${mountName.slice(1)}Mount`];
  const mount = typeof factory === "function"
    ? await factory({
        mountName,
        userDataPath,
        runtimeOptions
      })
    : loaded;
  if (!mount || typeof mount !== "object") {
    throw new Error("Module did not return a mount object.");
  }
  return mount;
}

function check(report, name, ok, details = "") {
  report.checks.push({ name, ok: Boolean(ok), details });
}

export async function runModuleContractTest(input = {}, options = {}) {
  const modulePath = normalizeText(input.modulePath || input.module || input.entrypoint);
  const mountName = normalizeText(input.mountName || input.mount || "documentParser");
  if (!modulePath) {
    throw new Error("modulePath is required.");
  }
  const userDataPath = path.resolve(
    normalizeText(input.userDataPath || input.dataDir) ||
      options.userDataPath ||
      ServerConfig.getDataDir()
  );
  await fs.mkdir(userDataPath, { recursive: true });
  const mount = await loadMount({
    modulePath,
    mountName,
    userDataPath,
    runtimeOptions: {
      cwd: normalizeText(input.repoRoot || input.repo) || process.cwd(),
      mountModules: { [mountName]: path.resolve(modulePath) },
      mountRouting: asObject(input.mountRouting)
    }
  });
  const report = {
    protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    mountName,
    modulePath: path.resolve(modulePath),
    id: mount.id || "",
    kind: mount.kind || mountName,
    ok: true,
    capabilities: {
      supports: typeof mount.supports === "function",
      extractDocument: typeof mount.extractDocument === "function",
      extractText: typeof mount.extractText === "function",
      onBatchCompleted: typeof mount.onBatchCompleted === "function",
      reload: typeof mount.reload === "function",
      close: typeof mount.close === "function",
      listModules: typeof mount.listModules === "function",
      listAlgorithms: typeof mount.listAlgorithms === "function",
      runAnalysis: typeof mount.runAnalysis === "function",
      search: typeof mount.search === "function",
      readEvidence: typeof mount.readEvidence === "function",
      upsertVectors: typeof mount.upsertVectors === "function",
      queryVectors: typeof mount.queryVectors === "function",
      upsertGraph: typeof mount.upsertGraph === "function",
      queryGraph: typeof mount.queryGraph === "function"
    },
    checks: []
  };

  check(report, "object", true, "module returned mount object");
  if (typeof mount.reload === "function") {
    await mount.reload({ settings: {}, mountName, runtimeOptions: {} });
    check(report, "reload", true);
  }

  const samplePath = normalizeText(input.samplePath || input.sample);
  if (samplePath && typeof mount.supports === "function") {
    const supported = await mount.supports({
      extension: path.extname(samplePath).toLowerCase(),
      mediaTypeHint: "",
      sourceKind: ""
    });
    check(report, "supports sample", supported !== false, String(supported));
  }
  if (samplePath && typeof mount.extractDocument === "function") {
    const document = await mount.extractDocument({
      filePath: path.resolve(samplePath),
      fileName: path.basename(samplePath),
      userDataPath
    });
    check(report, "extractDocument parserId", Boolean(document?.parserId), document?.parserId || "");
    check(report, "extractDocument text", typeof document?.text === "string", `text=${String(document?.text || "").length}`);
  }
  if (typeof mount.onBatchCompleted === "function") {
    await mount.onBatchCompleted({
      batchId: "contract-test",
      jobId: "contract-test",
      result: { sourceFiles: [], chunks: [] },
      settings: {}
    });
    check(report, "postCommit", true);
  }
  if (typeof mount.close === "function") {
    await mount.close();
    check(report, "close", true);
  }
  report.ok = report.checks.every((item) => item.ok);
  return report;
}

export function validateCapabilityPackageScaffoldManifest(input = {}) {
  const manifest = asObject(input.manifest || input);
  const issues = [];
  const required = ["kind", "name", "version", "capabilities", "license"];
  for (const field of required) {
    const value = manifest[field];
    if (!value || (Array.isArray(value) && value.length === 0)) {
      issues.push({ field, message: `${field} is required` });
    }
  }
  if (!["tool", "skill"].includes(String(manifest.kind || ""))) {
    issues.push({ field: "kind", message: "kind must be tool or skill" });
  }
  if (manifest.inputSchema && manifest.inputSchema.type !== "object") {
    issues.push({ field: "inputSchema", message: "inputSchema.type must be object" });
  }
  return {
    protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
    ok: issues.length === 0,
    issues,
    manifest: {
      kind: normalizeText(manifest.kind),
      name: normalizeText(manifest.name),
      version: normalizeText(manifest.version),
      capabilities: asArray(manifest.capabilities).map(normalizeText).filter(Boolean)
    }
  };
}
