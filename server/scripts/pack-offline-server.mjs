#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { TIKA_VERSION } from "../platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs";
import {
  collectPackagePlan,
  resolveFeatureRuntime,
  writeFeaturePlanArtifacts
} from "../platform/interactive/features/feature-manifest.mjs";
import { DEFAULT_SERVER_PORT } from "../config/ServerEnv.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const moduleResourceRoot = path.join(projectRoot, "modules");
const jreResourceRoot = path.join(moduleResourceRoot, "jre");
const tikaResourceRoot = path.join(moduleResourceRoot, "tika");
const ocrResourceRoot = path.join(moduleResourceRoot, "ocr");

const TARGETS = {
  "linux-x64": {
    nodePlatform: "linux-x64",
    dockerPlatform: "linux/amd64",
    jreFileName: "OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz",
    jreUrl:
      "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz"
  },
  "linux-arm64": {
    nodePlatform: "linux-arm64",
    dockerPlatform: "linux/arm64",
    jreFileName: "OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz",
    jreUrl:
      "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz"
  }
};

const BASE_RUNTIME_DEPENDENCIES = [
  "better-sqlite3",
  "docx",
  "fflate",
  "p-limit",
  "p-queue",
  "sqlite-vec"
];
const FEATURE_RUNTIME_DEPENDENCIES = Object.freeze({
  "knowledge-distillation": ["@langchain/langgraph"]
});
const DOCKER_PATH =
  "/pkg/runtime/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export const KNOWLEDGE_LICENSE_POLICY = Object.freeze({
  schemaVersion: "v0.0.1:schema:definition-1",
  id: "v0.0.1:offline:offline-knowledge-license-1",
  policy: "PERMISSIVE_OFFLINE_ONLY",
  allowedLicenses: [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "Zlib",
    "BlueOak-1.0.0",
    "0BSD",
    "CC0-1.0",
    "Unlicense",
    "project-internal"
  ],
  allowedLicenseExpressions: ["MIT OR Apache-2.0", "MIT OR Apache"],
  blockedClasses: [
    {
      id: "strong-copyleft",
      examples: ["GPL", "AGPL", "LGPL", "SSPL"]
    },
    {
      id: "network-copyleft-or-reciprocal",
      examples: ["MPL", "EPL", "CDDL"]
    },
    {
      id: "source-available-or-restricted",
      examples: ["BUSL", "PolyForm", "Commons-Clause", "proprietary"]
    },
    {
      id: "unknown-or-unreviewed",
      examples: ["UNKNOWN", "SEE LICENSE IN", "UNLICENSED", "NOASSERTION"]
    },
    {
      id: "model-risk",
      examples: ["unknown model weights", "restricted model", "cloud-only runtime"]
    },
    {
      id: "runtime-risk",
      examples: ["implicit download", "telemetry-required runtime", "remote execution required"]
    }
  ]
});

const LICENSE_ALIASES = Object.freeze({
  "Apache License 2.0": "Apache-2.0",
  "Apache 2.0": "Apache-2.0",
  "BSD": "BSD-2-Clause",
  "BSD License": "BSD-2-Clause",
  "The Unlicense": "Unlicense"
});

const DIRECT_LICENSE_OVERRIDES = Object.freeze({
  "better-sqlite3": "MIT",
  docx: "MIT",
  fflate: "MIT"
});

function parseArgs(argv) {
  const args = {
    target: "linux-x64",
    "output-dir": path.join("build", "release"),
    "node-version": process.versions.node,
    "verify-docker": true,
    "keep-staging": false,
    modules: "",
    "file-processor-components": ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const keyValue = item.slice(2);
    const equalIndex = keyValue.indexOf("=");
    const key = equalIndex >= 0 ? keyValue.slice(0, equalIndex) : keyValue;
    const inlineValue = equalIndex >= 0 ? keyValue.slice(equalIndex + 1) : null;
    const next = argv[index + 1];
    const value = inlineValue !== null ? inlineValue : !next || next.startsWith("--") ? true : next;
    if (inlineValue === null && value !== true) {
      index += 1;
    }
    if (key === "no-verify-docker") {
      args["verify-docker"] = false;
      continue;
    }
    args[key] = value;
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  node server/scripts/pack-offline-server.mjs --target linux-x64",
    "",
    "Options:",
    "  --target linux-x64|linux-arm64   Default: linux-x64.",
    "  --output-dir PATH                Default: build/release.",
    "  --node-version VERSION           Default: current Node version.",
    "  --modules LIST                   Optional modules to include, e.g. FileProcessor.",
    "  --file-processor-components LIST Optional FileProcessor components, e.g. tika,pdfProcessor,ocr.",
    "  --dry-run                        Validate the package plan and license gate without downloading or building.",
    "  --no-verify-docker               Build only; skip Ubuntu container verification.",
    "  --keep-staging                   Keep unpacked package directory."
  ].join("\n");
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createPackagingPlan(args = {}) {
  const featureRuntime = args.featureRuntime || resolveFeatureRuntime({
    edition: args.edition || "enterprise",
    enableFeatures: args.features,
    disableFeatures: args["without-features"]
  });
  const activeFeatures = new Set(featureRuntime.activeFeatureIds);
  const modules = new Set(parseCsvList(args.modules));
  if (activeFeatures.has("knowledge-core")) {
    modules.add("KnowledgeCore");
  }
  if (activeFeatures.has("document-parser")) {
    modules.add("FileProcessor");
  }
  if (activeFeatures.has("vector-store-external")) {
    modules.add("VectorStore");
  }
  const includeFileProcessor = modules.has("FileProcessor");
  const defaultFileProcessorComponents = includeFileProcessor
    ? [
        "tika",
        activeFeatures.has("ocr") ? "ocr" : "",
        activeFeatures.has("pdf-processor") ? "pdfProcessor" : "",
        "normalizedDocuments"
      ].filter(Boolean).join(",")
    : "";
  const fileProcessorComponents = new Set(
    parseCsvList(args["file-processor-components"] || defaultFileProcessorComponents)
  );
  const includeTika =
    includeFileProcessor &&
    (fileProcessorComponents.has("tika") || fileProcessorComponents.has("pdfProcessor"));

  return {
    modules: [...modules],
    includeKnowledgeCore: modules.has("KnowledgeCore"),
    includeVectorStore: modules.has("VectorStore"),
    includeFileProcessor,
    fileProcessorComponents: [...fileProcessorComponents],
    includeTika,
    includeOcr: includeFileProcessor && fileProcessorComponents.has("ocr"),
    featureProfile: {
      edition: featureRuntime.edition,
      activeFeatureIds: featureRuntime.activeFeatureIds,
      disabledFeatureIds: featureRuntime.disabledFeatureIds
    },
    featureRuntime,
    featurePackagePlan: collectPackagePlan(featureRuntime)
  };
}

export function runtimeDependenciesForPackagingPlan(packagingPlan = {}) {
  const dependencies = new Set(BASE_RUNTIME_DEPENDENCIES);
  const activeFeatures = new Set(packagingPlan.featureProfile?.activeFeatureIds || []);
  for (const [featureId, featureDependencies] of Object.entries(FEATURE_RUNTIME_DEPENDENCIES)) {
    if (!activeFeatures.has(featureId)) {
      continue;
    }
    for (const dependency of featureDependencies) {
      dependencies.add(dependency);
    }
  }
  return [...dependencies].sort();
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio || "inherit",
      cwd: options.cwd || projectRoot,
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
        ...options.env
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function downloadFile(url, targetPath) {
  await ensureDirectory(path.dirname(targetPath));
  if (await pathExists(targetPath)) {
    return;
  }
  const tempPath = `${targetPath}.download`;

  async function request(currentUrl, redirectCount = 0) {
    if (redirectCount > 5) {
      throw new Error(`Too many redirects while downloading ${url}`);
    }

    await new Promise((resolve, reject) => {
      https
        .get(currentUrl, (response) => {
          const location = response.headers.location;
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
            response.resume();
            request(new URL(location, currentUrl).toString(), redirectCount + 1).then(resolve, reject);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Download failed ${response.statusCode}: ${currentUrl}`));
            return;
          }
          pipeline(response, createWriteStream(tempPath)).then(resolve, reject);
        })
        .once("error", reject);
    });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await fs.rm(tempPath, { force: true });
      await request(url);
      await fs.rename(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      await fs.rm(tempPath, { force: true });
      if (attempt < 3) {
        console.log(`Download failed, retrying (${attempt}/3): ${url}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }
  throw lastError || new Error(`Download failed: ${url}`);
}

async function listVisibleEntries(targetPath) {
  try {
    return (await fs.readdir(targetPath, { withFileTypes: true })).filter(
      (entry) => !entry.name.startsWith(".")
    );
  } catch {
    return [];
  }
}

async function flattenSingleTopLevelDirectory(targetPath) {
  const entries = await listVisibleEntries(targetPath);
  if (entries.length !== 1 || !entries[0].isDirectory()) {
    return;
  }
  const nestedRoot = path.join(targetPath, entries[0].name);
  const nestedEntries = await fs.readdir(nestedRoot, { withFileTypes: true });
  for (const entry of nestedEntries) {
    await fs.rename(path.join(nestedRoot, entry.name), path.join(targetPath, entry.name));
  }
  await fs.rm(nestedRoot, { recursive: true, force: true });
}

async function extractTar(archivePath, targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await ensureDirectory(targetPath);
  await run("tar", ["-xf", archivePath, "-C", targetPath]);
  await flattenSingleTopLevelDirectory(targetPath);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function copyPath(sourcePath, targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    filter: (source) => !path.basename(source).startsWith(".DS_Store")
  });
}

async function walkSourceFiles(rootPath) {
  const files = [];
  async function visit(currentPath) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }
        await visit(entryPath);
      } else if (entry.isFile() && /\.(?:mjs|js|ts|vue)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }
  await visit(rootPath);
  return files;
}

function staticImportSpecifiers(sourceText = "") {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?!\()(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(sourceText))) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveStaticSpecifier(filePath, specifier) {
  if (!specifier.startsWith(".")) {
    return "";
  }
  return path.resolve(path.dirname(filePath), specifier);
}

function isInsideOrEqual(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isCascadePrunableSource(relativeFilePath = "") {
  const normalized = String(relativeFilePath || "").replace(/\\/g, "/");
  return (
    normalized.startsWith("server/platform/specialized/knowledge/") ||
    normalized.startsWith("server/platform/modules/knowledge/") ||
    normalized.startsWith("server/scripts/verify-") ||
    normalized === "server/scripts/build-transaction-continuity.mjs" ||
    normalized === "server/scripts/migrate-embeddings.mjs" ||
    normalized === "server/scripts/pack-offline-server.mjs" ||
    normalized === "server/scripts/setup-local-runtime.mjs"
  );
}

async function collectStaticImportViolations(stagingPath, plannedRoots) {
  const staticImportViolations = [];
  for (const filePath of await walkSourceFiles(path.join(stagingPath, "server"))) {
    const text = await fs.readFile(filePath, "utf8");
    for (const specifier of staticImportSpecifiers(text)) {
      const resolved = resolveStaticSpecifier(filePath, specifier);
      if (!resolved) {
        continue;
      }
      const violationRoot = plannedRoots.find((rootPath) => isInsideOrEqual(resolved, rootPath));
      if (violationRoot) {
        staticImportViolations.push({
          file: path.relative(stagingPath, filePath),
          specifier,
          plannedPath: path.relative(stagingPath, violationRoot)
        });
      }
    }
  }
  return staticImportViolations;
}

export async function applyFeatureSourcePlan(stagingPath, packagingPlan) {
  const plannedPaths = [...new Set(packagingPlan.featurePackagePlan?.removePaths || [])]
    .map((relativePath) => String(relativePath || "").trim())
    .filter(Boolean);
  const applied = [];
  for (const relativePath of plannedPaths) {
    const targetPath = path.join(stagingPath, relativePath);
    if (await pathExists(targetPath)) {
      await fs.rm(targetPath, { recursive: true, force: true });
      applied.push(relativePath);
    }
  }

  const lingeringPaths = [];
  for (const relativePath of plannedPaths) {
    if (await pathExists(path.join(stagingPath, relativePath))) {
      lingeringPaths.push(relativePath);
    }
  }

  const plannedRoots = plannedPaths.map((relativePath) => path.resolve(stagingPath, relativePath));
  const cascadePrunedFiles = [];
  for (;;) {
    const violations = await collectStaticImportViolations(stagingPath, plannedRoots);
    const prunableFiles = [...new Set(
      violations
        .map((violation) => violation.file)
        .filter(isCascadePrunableSource)
    )].sort();
    if (prunableFiles.length === 0) {
      break;
    }
    for (const relativeFilePath of prunableFiles) {
      const targetPath = path.join(stagingPath, relativeFilePath);
      if (await pathExists(targetPath)) {
        await fs.rm(targetPath, { force: true });
        cascadePrunedFiles.push(relativeFilePath);
      }
    }
  }
  const staticImportViolations = await collectStaticImportViolations(stagingPath, plannedRoots);

  const report = {
    schemaVersion: "v0.0.1:schema:definition-1",
    generatedAt: new Date().toISOString(),
    edition: packagingPlan.featureProfile?.edition || "",
    requestedPaths: plannedPaths,
    applied,
    cascadePrunedFiles,
    lingeringPaths,
    staticImportViolations,
    ok: lingeringPaths.length === 0 && staticImportViolations.length === 0
  };
  await ensureDirectory(path.join(stagingPath, "feature-profile"));
  await fs.writeFile(
    path.join(stagingPath, "feature-profile", "source-layout-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  if (!report.ok) {
    throw new Error(`Source layout verification failed: ${JSON.stringify({
      lingeringPaths,
      staticImportViolations: staticImportViolations.slice(0, 8)
    })}`);
  }
  return report;
}

function exactVersion(value) {
  return String(value || "").replace(/^[~^]/, "");
}

function normalizeLicenseValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeLicenseValue).filter(Boolean).join(" OR ");
  }
  if (value && typeof value === "object") {
    return normalizeLicenseValue(value.type || value.license || value.name || "");
  }
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLicenseToken(value) {
  const trimmed = String(value || "")
    .replace(/^\(+/, "")
    .replace(/\)+$/, "")
    .trim();
  return LICENSE_ALIASES[trimmed] || trimmed;
}

function licenseTokenClass(token, policy = KNOWLEDGE_LICENSE_POLICY) {
  const normalized = normalizeLicenseToken(token);
  if (!normalized) {
    return { licenseClass: "UNKNOWN", reason: "missing license token" };
  }

  if (policy.allowedLicenses.includes(normalized)) {
    return { licenseClass: "ALLOWED", token: normalized };
  }

  const upper = normalized.toUpperCase();
  const unknownClass = policy.blockedClasses.find((entry) => entry.id === "unknown-or-unreviewed");
  if (
    unknownClass?.examples.some((example) => {
      const marker = String(example).toUpperCase();
      return upper === marker || upper.includes(marker);
    })
  ) {
    return {
      licenseClass: "UNKNOWN",
      token: normalized,
      reason: "missing, unknown, or unreviewed license"
    };
  }

  const blockedClass = policy.blockedClasses.find((entry) =>
    entry.examples.some((example) => upper.includes(String(example).toUpperCase()))
  );
  if (blockedClass) {
    return {
      licenseClass: "BLOCKED",
      blockedClass: blockedClass.id,
      token: normalized,
      reason: `matches blocked class ${blockedClass.id}`
    };
  }

  return {
    licenseClass: "UNKNOWN",
    token: normalized,
    reason: "not present in allowed license list"
  };
}

export function classifyLicenseExpression(value, policy = KNOWLEDGE_LICENSE_POLICY) {
  const expression = normalizeLicenseValue(value);
  if (!expression) {
    return {
      expression: "UNKNOWN",
      licenseClass: "UNKNOWN",
      status: "unknown",
      reason: "missing license expression"
    };
  }

  const allowedExpressions = new Set(policy.allowedLicenseExpressions || []);
  if (allowedExpressions.has(expression)) {
    return {
      expression,
      licenseClass: "ALLOWED",
      status: "allowed",
      reason: "allowed expression"
    };
  }

  const alternatives = expression
    .replace(/^\(+/, "")
    .replace(/\)+$/, "")
    .split(/\s+OR\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
  const evaluatedAlternatives = alternatives.map((alternative) => {
    const tokens = alternative
      .split(/\s+AND\s+/i)
      .map((token) => licenseTokenClass(token, policy));
    const blocked = tokens.find((token) => token.licenseClass === "BLOCKED");
    const unknown = tokens.find((token) => token.licenseClass === "UNKNOWN");
    const allowed = tokens.length > 0 && tokens.every((token) => token.licenseClass === "ALLOWED");
    return { alternative, tokens, allowed, blocked, unknown };
  });

  const allowedAlternative = evaluatedAlternatives.find((alternative) => alternative.allowed);
  if (allowedAlternative) {
    return {
      expression,
      licenseClass: "ALLOWED",
      status: "allowed",
      selectedAlternative: allowedAlternative.alternative
    };
  }

  const blockedAlternative = evaluatedAlternatives.find((alternative) => alternative.blocked);
  if (blockedAlternative) {
    return {
      expression,
      licenseClass: "BLOCKED",
      status: "blocked",
      blockedClass: blockedAlternative.blocked.blockedClass,
      reason: blockedAlternative.blocked.reason
    };
  }

  const unknownAlternative = evaluatedAlternatives.find((alternative) => alternative.unknown);
  return {
    expression,
    licenseClass: "UNKNOWN",
    status: "unknown",
    reason: unknownAlternative?.unknown?.reason || "license expression is not in the allowlist"
  };
}

export function validateKnowledgeLicensePolicy(policy = KNOWLEDGE_LICENSE_POLICY) {
  const errors = [];
  const allowedLicenses = new Set(policy.allowedLicenses || []);
  for (const license of policy.allowedLicenses || []) {
    const result = classifyLicenseExpression(license, policy);
    if (result.status !== "allowed") {
      errors.push(`Allowed license ${license} does not classify as allowed`);
    }
  }
  for (const expression of policy.allowedLicenseExpressions || []) {
    const result = classifyLicenseExpression(expression, policy);
    if (result.status !== "allowed") {
      errors.push(`Allowed expression ${expression} does not classify as allowed`);
    }
  }
  if (!allowedLicenses.has("project-internal")) {
    errors.push("project-internal must be explicitly allowed for built-in KnowledgeCore components");
  }
  if (!Array.isArray(policy.blockedClasses) || policy.blockedClasses.length === 0) {
    errors.push("blockedClasses must be non-empty");
  }
  for (const blockedClass of policy.blockedClasses || []) {
    if (!blockedClass.id || !Array.isArray(blockedClass.examples) || blockedClass.examples.length === 0) {
      errors.push(`Blocked class ${blockedClass.id || "<missing>"} must include examples`);
    }
  }
  return { ok: errors.length === 0, errors };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function packageNameFromLockPath(packagePath) {
  const tail = String(packagePath || "").split("node_modules/").pop() || "";
  const parts = tail.split("/").filter(Boolean);
  if (parts[0]?.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0] || "";
}

function dependencyLockPath(basePath, dependencyName) {
  const suffix = `node_modules/${dependencyName}`;
  return basePath ? `${basePath}/${suffix}` : suffix;
}

function resolveDependencyLockPath(packages, fromPackagePath, dependencyName) {
  let basePath = fromPackagePath || "";
  while (true) {
    const candidate = dependencyLockPath(basePath, dependencyName);
    if (packages[candidate]) {
      return candidate;
    }
    if (!basePath) {
      return "";
    }
    const nestedIndex = basePath.lastIndexOf("/node_modules/");
    if (nestedIndex >= 0) {
      basePath = basePath.slice(0, nestedIndex);
    } else {
      basePath = "";
    }
  }
}

function collectDependencyClosureFromLock(lockFile, rootDependencyNames) {
  const packages = lockFile?.packages || {};
  const seen = new Set();
  const queue = [];
  const missing = [];

  for (const dependencyName of rootDependencyNames) {
    const packagePath = resolveDependencyLockPath(packages, "", dependencyName);
    if (packagePath) {
      queue.push(packagePath);
    } else {
      missing.push({
        name: dependencyName,
        packagePath: `node_modules/${dependencyName}`,
        version: "",
        license: "UNKNOWN",
        missing: true
      });
    }
  }

  while (queue.length > 0) {
    const packagePath = queue.shift();
    if (!packagePath || seen.has(packagePath)) {
      continue;
    }
    seen.add(packagePath);
    const metadata = packages[packagePath] || {};
    const dependencyNames = [
      ...Object.keys(metadata.dependencies || {}),
      ...Object.keys(metadata.optionalDependencies || {})
    ];
    for (const dependencyName of dependencyNames) {
      const dependencyPath = resolveDependencyLockPath(packages, packagePath, dependencyName);
      if (dependencyPath && !seen.has(dependencyPath)) {
        queue.push(dependencyPath);
      }
    }
  }

  return [...seen].map((packagePath) => ({ packagePath, metadata: packages[packagePath] || {} })).concat(
    missing.map((entry) => ({ packagePath: entry.packagePath, metadata: entry }))
  );
}

function collectAllProductionPackagesFromLock(lockFile) {
  return Object.entries(lockFile?.packages || {})
    .filter(([packagePath, metadata]) => packagePath.startsWith("node_modules/") && metadata?.dev !== true)
    .map(([packagePath, metadata]) => ({ packagePath, metadata }));
}

async function readInstalledPackageLicense(stagingPath, packagePath) {
  if (!stagingPath || !packagePath.startsWith("node_modules/")) {
    return "";
  }
  const packageJson = await readJsonIfExists(path.join(stagingPath, packagePath, "package.json"));
  return normalizeLicenseValue(packageJson?.license || packageJson?.licenses || "");
}

async function collectProductionNpmDependencies({ stagingPath = "", rootPackage, runtimeDependencies }) {
  const stagingLockPath = stagingPath ? path.join(stagingPath, "package-lock.json") : "";
  const stagingLock = stagingLockPath ? await readJsonIfExists(stagingLockPath) : null;
  const rootLock = stagingLock ? null : await readJsonIfExists(path.join(projectRoot, "package-lock.json"));
  const scanSource = stagingLock
    ? "staging-package-lock"
    : rootLock
      ? "root-package-lock-runtime-closure"
      : "missing-package-lock";
  const entries = stagingLock
    ? collectAllProductionPackagesFromLock(stagingLock)
    : rootLock
      ? collectDependencyClosureFromLock(rootLock, runtimeDependencies)
      : runtimeDependencies.map((name) => ({
          packagePath: `node_modules/${name}`,
          metadata: {
            name,
            version: exactVersion(rootPackage.dependencies?.[name]),
            license: "UNKNOWN",
            missing: true
          }
        }));

  const dependencies = [];
  for (const { packagePath, metadata } of entries) {
    const name = metadata.name || packageNameFromLockPath(packagePath);
    const installedLicense = await readInstalledPackageLicense(stagingPath, packagePath);
    const license = normalizeLicenseValue(
      metadata.license || metadata.licenses || installedLicense || DIRECT_LICENSE_OVERRIDES[name] || "UNKNOWN"
    );
    const classification = classifyLicenseExpression(license);
    dependencies.push({
      name,
      version: String(metadata.version || exactVersion(rootPackage.dependencies?.[name]) || ""),
      packagePath,
      direct: runtimeDependencies.includes(name) && packagePath === `node_modules/${name}`,
      production: true,
      license: classification.expression,
      licenseClass: classification.licenseClass,
      status: classification.status,
      blockedClass: classification.blockedClass || "",
      reason: classification.reason || "",
      source: metadata.license || metadata.licenses
        ? scanSource
        : installedLicense
          ? "installed-package-json"
          : DIRECT_LICENSE_OVERRIDES[name]
            ? "direct-override"
            : scanSource,
      missing: Boolean(metadata.missing)
    });
  }

  dependencies.sort((left, right) => left.packagePath.localeCompare(right.packagePath));
  return { scanSource, dependencies };
}

async function writeRuntimePackageJson(stagingPath, packagingPlan) {
  const rootPackage = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  const dependencies = {};
  for (const name of runtimeDependenciesForPackagingPlan(packagingPlan)) {
    dependencies[name] = exactVersion(rootPackage.dependencies?.[name]);
    if (!dependencies[name]) {
      throw new Error(`package.json is missing runtime dependency ${name}`);
    }
  }
  await fs.writeFile(
    path.join(stagingPath, "package.json"),
    JSON.stringify(
      {
        name: `${rootPackage.name}-offline-server`,
        version: rootPackage.version,
        private: true,
        type: "module",
        dependencies,
        scripts: {
          start: "node server/scripts/start-server.mjs --with-ui"
        }
      },
      null,
      2
    ),
    "utf8"
  );
}

async function writeLauncherScripts(stagingPath, targetKey, packagingPlan) {
  const binDir = path.join(stagingPath, "bin");
  await ensureDirectory(binDir);
  const javaPath = `$ROOT/modules/jre/${targetKey}/bin/java`;
  const commonHeader = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
    'export PATH="$ROOT/runtime/node/bin:$PATH"',
    `export PACT_SERVER_PROFILE="\${PACT_SERVER_PROFILE:-${packagingPlan.includeFileProcessor ? "default" : "minimal"}}"`,
    `export PACT_FEATURE_EDITION="\${PACT_FEATURE_EDITION:-${packagingPlan.featureProfile?.edition || "enterprise"}}"`,
    'export PACT_FEATURE_PROFILE="${PACT_FEATURE_PROFILE:-$ROOT/feature-profile/feature-profile.json}"',
    `export PACT_FEATURES="\${PACT_FEATURES:-${(packagingPlan.featureProfile?.activeFeatureIds || []).join(",")}}"`,
    'export PACT_SERVER_DATA_DIR="${PACT_SERVER_DATA_DIR:-$ROOT/data}"',
    'export PACT_SERVER_HOST="${PACT_SERVER_HOST:-0.0.0.0}"',
    `export PACT_SERVER_PORT="\${PACT_SERVER_PORT:-${DEFAULT_SERVER_PORT}}"`
  ];
  if (packagingPlan.includeTika) {
    commonHeader.push(
      `export PACT_JAVA_BIN_PATH="\${PACT_JAVA_BIN_PATH:-${javaPath}}"`,
      `export PACT_TIKA_JAR_PATH="\${PACT_TIKA_JAR_PATH:-$ROOT/modules/tika/tika-app-${TIKA_VERSION}.jar}"`
    );
  }
  await fs.writeFile(
    path.join(binDir, "start-server"),
    [
      ...commonHeader,
      'exec "$ROOT/runtime/node/bin/node" "$ROOT/server/scripts/start-server.mjs" --with-ui "$@"',
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(binDir, "pact"),
    [
      ...commonHeader,
      'export PACT_SERVER_URL="${PACT_SERVER_URL:-http://127.0.0.1:${PACT_SERVER_PORT}}"',
      'exec "$ROOT/runtime/node/bin/node" "$ROOT/server/scripts/pact.mjs" "$@"',
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.chmod(path.join(binDir, "start-server"), 0o755);
  await fs.chmod(path.join(binDir, "pact"), 0o755);
}

async function writeRunbook(stagingPath, targetKey, packagingPlan) {
  const includedRuntime = [
    `- Linux target: \`${targetKey}\``,
    "- Node.js: `runtime/node/`"
  ];
  if (packagingPlan.includeTika) {
    includedRuntime.push(
      `- JRE: \`modules/jre/${targetKey}/\``,
      `- Tika: \`modules/tika/tika-app-${TIKA_VERSION}.jar\``
    );
  }
  includedRuntime.push(
    "- Native production dependencies: `node_modules/` built in an Ubuntu container",
    "- KnowledgeCore: embedded protocol module with SQLite metadata, asset storage, Markdown evidence rendering, and local vector fallback",
    "- License manifest: `license-manifest.json` with production dependency and knowledge component gate results",
    "- Vue console static assets: `build/dist`"
  );

  await fs.writeFile(
    path.join(stagingPath, "OFFLINE-UBUNTU-RUNBOOK.md"),
    [
      "# Pact Offline Ubuntu Server",
      "",
      "This package is designed for a closed LAN Ubuntu host. Do not run `apt update` or `apt install` on the target host.",
      "",
      "## Included Runtime",
      "",
      ...includedRuntime,
      "",
      "## Modules",
      "",
      packagingPlan.modules.length > 0
        ? `- Included modules: \`${packagingPlan.modules.join(",")}\``
        : "- Included modules: none. Runtime profile defaults to `minimal`.",
      packagingPlan.fileProcessorComponents.length > 0
        ? `- FileProcessor components: \`${packagingPlan.fileProcessorComponents.join(",")}\``
        : "- FileProcessor components: none.",
      "- KnowledgeCore is included as a server-side protocol module. External vector or embedding providers may be mounted later without changing application APIs.",
      "",
      "## License Gate",
      "",
      "- `license-manifest.json` records allowed licenses, blocked classes, production npm dependency classifications, and KnowledgeCore / EmbeddingRuntime / VectorStore component status.",
      "- Blocked or unknown production dependency licenses fail packaging.",
      packagingPlan.includeVectorStore
        ? "- `sqlite-vec` is bundled through the npm package and target platform optional native package after license validation. ONNX runtime and model assets remain `not-bundled-license-gated` until explicitly reviewed."
        : "- `sqlite-vec`, ONNX runtime, and ONNX model assets are not bundled by this package plan; they remain `not-bundled-license-gated` until explicitly reviewed.",
      "",
      "## Start",
      "",
      "```bash",
      "tar -xzf pact-server-*.tar.gz",
      "cd pact-server-*",
      `./bin/start-server --host 0.0.0.0 --port ${DEFAULT_SERVER_PORT} --data-dir ./data`,
      "```",
      "",
      "The server console is enabled by default and is served from the bundled `build/dist` directory.",
      "",
      "## Verify",
      "",
      "```bash",
      "./runtime/node/bin/node -v",
      packagingPlan.includeTika ? `./modules/jre/${targetKey}/bin/java -version` : "# Java/Tika omitted by this package plan.",
      `./bin/pact health --server-url http://127.0.0.1:${DEFAULT_SERVER_PORT}`,
      "```",
      "",
      "## Important Environment Variables",
      "",
      "- `PACT_SERVER_DATA_DIR`: defaults to `<package>/data`",
      "- `PACT_SERVER_HOST`: defaults to `0.0.0.0`",
      `- \`PACT_SERVER_PORT\`: defaults to \`${DEFAULT_SERVER_PORT}\``,
      "- `PACT_SERVER_PROFILE`: defaults to `minimal` unless FileProcessor is included",
      packagingPlan.includeTika
        ? "- `PACT_JAVA_BIN_PATH`: defaults to bundled JRE"
        : "- `PACT_JAVA_BIN_PATH`: not set unless supplied by operator",
      packagingPlan.includeTika
        ? "- `PACT_TIKA_JAR_PATH`: defaults to bundled Tika"
        : "- `PACT_TIKA_JAR_PATH`: not set unless supplied by operator",
      "- `PACT_TIKA_TIMEOUT_MS`: defaults to 1800000",
      "",
      packagingPlan.includeTika
        ? "The package still requires a compatible Linux kernel and glibc from the host OS, but it does not require host Node.js, npm, Java, Tika, Python, or any apt-installed application dependency."
        : "The package still requires a compatible Linux kernel and glibc from the host OS, but it does not require host Node.js, npm, Java, Tika, Python, or any apt-installed application dependency for the minimal module set.",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function prepareSourceTree(stagingPath, targetKey, target, nodeVersion, packagingPlan) {
  await ensureDirectory(stagingPath);
  await writeRuntimePackageJson(stagingPath, packagingPlan);
  await copyPath(path.join(projectRoot, "server"), path.join(stagingPath, "server"));
  await copyPath(path.join(projectRoot, "build", "dist"), path.join(stagingPath, "build", "dist"));
  await writeFeaturePlanArtifacts({
    outputDir: path.join(stagingPath, "feature-profile"),
    featureRuntime: packagingPlan.featureRuntime,
    packagePlan: packagingPlan.featurePackagePlan
  });
  await fs.writeFile(
    path.join(stagingPath, "feature-profile", "feature-profile.json"),
    `${JSON.stringify({
      schemaVersion: "v0.0.1:schema:definition-1",
      edition: packagingPlan.featureProfile?.edition || "enterprise",
      features: packagingPlan.featureProfile?.activeFeatureIds || []
    }, null, 2)}\n`,
    "utf8"
  );
  await applyFeatureSourcePlan(stagingPath, packagingPlan);
  if (packagingPlan.includeOcr && await pathExists(ocrResourceRoot)) {
    await copyPath(ocrResourceRoot, path.join(stagingPath, "modules", "ocr"));
  }

  const nodeArchiveName = `node-v${nodeVersion}-${target.nodePlatform}.tar.xz`;
  const nodeArchivePath = path.join(jreResourceRoot, "downloads", nodeArchiveName);
  const nodeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`;
  console.log(`Ensuring Node runtime: ${nodeUrl}`);
  await downloadFile(nodeUrl, nodeArchivePath);
  await extractTar(nodeArchivePath, path.join(stagingPath, "runtime", "node"));

  if (packagingPlan.includeTika) {
    const jreArchivePath = path.join(jreResourceRoot, "downloads", target.jreFileName);
    console.log(`Ensuring JRE runtime: ${target.jreUrl}`);
    await downloadFile(target.jreUrl, jreArchivePath);
    await extractTar(jreArchivePath, path.join(stagingPath, "modules", "jre", targetKey));

    const tikaUrl = `https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar`;
    const tikaSourcePath = path.join(tikaResourceRoot, `tika-app-${TIKA_VERSION}.jar`);
    const tikaTargetPath = path.join(stagingPath, "modules", "tika", `tika-app-${TIKA_VERSION}.jar`);
    await ensureDirectory(path.dirname(tikaTargetPath));
    console.log(`Ensuring Tika runtime: ${tikaUrl}`);
    if (!(await pathExists(tikaSourcePath))) {
      await downloadFile(tikaUrl, tikaSourcePath);
    }
    await fs.copyFile(tikaSourcePath, tikaTargetPath);
  }

  await writeLauncherScripts(stagingPath, targetKey, packagingPlan);
  await writeRunbook(stagingPath, targetKey, packagingPlan);
}

async function installLinuxNodeModules(stagingPath, target) {
  console.log("Installing production node_modules inside Ubuntu without apt...");
  const installArgs = [
    "run",
    "--rm",
    "--platform",
    target.dockerPlatform,
    "--env",
    `PATH=${DOCKER_PATH}`,
    "--env",
    "npm_config_fetch_retries=5",
    "--env",
    "npm_config_fetch_retry_mintimeout=10000",
    "--env",
    "npm_config_fetch_retry_maxtimeout=120000",
    "-v",
    `${stagingPath}:/pkg`,
    "-w",
    "/pkg",
    "ubuntu:22.04",
    "/pkg/runtime/node/bin/npm",
    "install",
    "--omit=dev",
    "--package-lock=true",
    "--no-audit",
    "--no-fund"
  ];
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await run("docker", installArgs);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      console.warn(`Production node_modules install failed; retrying ${attempt + 1}/${maxAttempts} after clean staging install...`);
      await fs.rm(path.join(stagingPath, "node_modules"), { recursive: true, force: true });
      await fs.rm(path.join(stagingPath, "package-lock.json"), { force: true });
      await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

function createOfflineManifest(targetKey, nodeVersion, packagingPlan) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    packageType: "pact.offline-server",
    target: targetKey,
    generatedAt: new Date().toISOString(),
    nodeVersion,
    tikaVersion: TIKA_VERSION,
    bundled: {
      node: "runtime/node",
      jre: packagingPlan.includeTika ? `modules/jre/${targetKey}` : "",
      tika: packagingPlan.includeTika ? `modules/tika/tika-app-${TIKA_VERSION}.jar` : "",
      nodeModules: "node_modules",
      consoleDist: "build/dist"
    },
    modules: packagingPlan.modules,
    featureProfile: packagingPlan.featureProfile,
    activeFeatures: packagingPlan.featureProfile?.activeFeatureIds || [],
    disabledFeatures: packagingPlan.featureProfile?.disabledFeatureIds || [],
    featurePackagePlan: packagingPlan.featurePackagePlan || null,
    fileProcessorComponents: packagingPlan.fileProcessorComponents,
    runtimeDependencies: runtimeDependenciesForPackagingPlan(packagingPlan),
    noAptRequiredAtRuntime: true
  };
}

async function writeOfflineManifest(stagingPath, targetKey, nodeVersion, packagingPlan) {
  const manifest = createOfflineManifest(targetKey, nodeVersion, packagingPlan);
  await fs.writeFile(path.join(stagingPath, "offline-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

export async function createKnowledgeLicenseManifest({
  stagingPath = "",
  packagingPlan = createPackagingPlan({}),
  generatedAt = new Date().toISOString()
} = {}) {
  const rootPackage = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  const dependencyScan = await collectProductionNpmDependencies({
    stagingPath,
    rootPackage,
    runtimeDependencies: runtimeDependenciesForPackagingPlan(packagingPlan)
  });
  const licenseSummary = dependencyScan.dependencies.reduce(
    (summary, dependency) => {
      summary.total += 1;
      summary[dependency.status] = (summary[dependency.status] || 0) + 1;
      return summary;
    },
    { total: 0, allowed: 0, blocked: 0, unknown: 0 }
  );

  const manifest = {
    schemaVersion: 2,
    packageType: "pact.license-manifest",
    generatedAt,
    policy: KNOWLEDGE_LICENSE_POLICY,
    enforcement: {
      productionDependencyRule: "blocked-or-unknown-production-dependencies-fail",
      optionalAssetRule: "optional native/vector/model targets are not bundled unless explicitly listed as allowed",
      implicitDownloadRule: "offline packages must not download models, runtimes, or native extensions at startup"
    },
    modules: packagingPlan.modules,
    fileProcessorComponents: packagingPlan.fileProcessorComponents,
    npm: {
      scanSource: dependencyScan.scanSource,
      runtimeDependencyRoots: runtimeDependenciesForPackagingPlan(packagingPlan),
      productionDependencies: dependencyScan.dependencies,
      summary: licenseSummary
    },
    npmDependencies: Object.fromEntries(
      dependencyScan.dependencies.map((dependency) => [
        dependency.packagePath,
        {
          name: dependency.name,
          version: dependency.version,
          direct: dependency.direct,
          production: dependency.production,
          license: dependency.license,
          licenseClass: dependency.licenseClass,
          status: dependency.status,
          blockedClass: dependency.blockedClass,
          reason: dependency.reason
        }
      ])
    ),
    components: {
      KnowledgeCore: {
        included: Boolean(packagingPlan.includeKnowledgeCore),
        bundled: Boolean(packagingPlan.includeKnowledgeCore),
        license: "project-internal",
        status: packagingPlan.includeKnowledgeCore ? "allowed" : "not-bundled",
        protocolVersion: "v0.0.1:knowledge:core-1",
        storage: {
          sqlite: "knowledge-core/knowledge.sqlite",
          assets: "knowledge-core/assets"
        },
        boundary: "Application layer must call the knowledgeBase mount protocol; it must not access KnowledgeCore storage directly."
      },
      EmbeddingRuntime: {
        included: Boolean(packagingPlan.includeKnowledgeCore),
        bundled: Boolean(packagingPlan.includeKnowledgeCore),
        protocolVersion: "v0.0.1:knowledge:embedding-1",
        license: "project-internal",
        status: packagingPlan.includeKnowledgeCore ? "allowed" : "not-bundled",
        bundledProviders: [
          {
            id: "builtin:hashing-multilingual-v1",
            role: "offline deterministic text embedding fallback",
            license: "project-internal",
            status: "allowed"
          },
          {
            id: "builtin:asset-ocr-caption-v1",
            role: "offline image evidence fallback based on OCR/caption/asset metadata",
            license: "project-internal",
            status: "allowed"
          },
          {
            id: "builtin:mixed-evidence-v1",
            role: "offline mixed evidence score fusion",
            license: "project-internal",
            status: "allowed"
          }
        ],
        optionalTargets: [
          {
            id: "onnxruntime-node",
            kind: "ONNX runtime",
            bundled: false,
            license: "MIT",
            status: "not-bundled-license-gated"
          },
          {
            id: "intfloat/multilingual-e5-small",
            kind: "ONNX text embedding model",
            bundled: false,
            license: "MIT",
            status: "not-bundled-license-gated",
            requirement: "Operator-provided model artifact must be added with an explicit manifest entry before bundling."
          }
        ]
      },
      VectorStore: {
        included: Boolean(packagingPlan.includeVectorStore),
        bundled: Boolean(packagingPlan.includeVectorStore),
        protocolVersion: "v0.0.1:knowledge:vector-1",
        license: packagingPlan.includeVectorStore ? "project-internal" : "",
        status: packagingPlan.includeVectorStore ? "allowed" : "not-bundled",
        primaryBackend: packagingPlan.includeVectorStore ? "sqlite-vec" : "not-bundled",
        builtinFallback: {
          id: "builtin:sqlite-json-vector-store",
          bundledWith: "KnowledgeCore",
          license: "project-internal",
          status: packagingPlan.includeKnowledgeCore ? "allowed" : "not-bundled"
        },
        optionalTargets: [
          {
            id: "sqlite-vec",
            kind: "native SQLite vector extension",
            bundled: Boolean(packagingPlan.includeVectorStore),
            license: "MIT OR Apache",
            status: packagingPlan.includeVectorStore ? "allowed" : "not-bundled-license-gated",
            requirement: packagingPlan.includeVectorStore
              ? "Bundled through sqlite-vec npm package and platform optional dependency; production dependency license gate must pass."
              : "Native binary and license must be reviewed before it can move to bundled=true."
          }
        ]
      }
    }
  };
  return manifest;
}

export function validateKnowledgeLicenseManifest(manifest) {
  const errors = [];
  const warnings = [];
  const policyReport = validateKnowledgeLicensePolicy(manifest?.policy || KNOWLEDGE_LICENSE_POLICY);
  errors.push(...policyReport.errors);

  if (!manifest || manifest.packageType !== "pact.license-manifest") {
    errors.push("Manifest packageType must be pact.license-manifest");
  }

  const dependencies = Array.isArray(manifest?.npm?.productionDependencies)
    ? manifest.npm.productionDependencies
    : Object.entries(manifest?.npmDependencies || {}).map(([packagePath, dependency]) => ({
        packagePath,
        ...dependency
      }));
  if (dependencies.length === 0) {
    errors.push("Manifest must include npm.productionDependencies");
  }

  for (const dependency of dependencies) {
    if (!dependency.production) {
      continue;
    }
    const classification = classifyLicenseExpression(dependency.license, manifest?.policy || KNOWLEDGE_LICENSE_POLICY);
    const status = dependency.status || classification.status;
    const label = `${dependency.name || dependency.packagePath || "<unknown>"}@${dependency.version || ""}`;
    if (dependency.missing) {
      errors.push(`${label} is missing from the production dependency lockfile`);
    }
    if (classification.status === "blocked" || status === "blocked") {
      errors.push(`${label} has blocked license ${classification.expression}`);
    }
    if (classification.status === "unknown" || status === "unknown" || classification.expression === "UNKNOWN") {
      errors.push(`${label} has UNKNOWN or unallowlisted license ${classification.expression}`);
    }
  }

  const components = manifest?.components || {};
  for (const componentName of ["KnowledgeCore", "EmbeddingRuntime", "VectorStore"]) {
    if (!components[componentName]) {
      errors.push(`Manifest must include ${componentName} component status`);
    }
  }

  for (const [componentName, component] of Object.entries(components)) {
    if (component.bundled && component.status !== "allowed") {
      errors.push(`${componentName} is bundled but status is ${component.status || "missing"}`);
    }
    if (component.bundled) {
      const classification = classifyLicenseExpression(component.license || "UNKNOWN", manifest?.policy || KNOWLEDGE_LICENSE_POLICY);
      if (classification.status !== "allowed") {
        errors.push(`${componentName} has unallowlisted license ${classification.expression}`);
      }
    }
  }

  const vectorTargets = components.VectorStore?.optionalTargets || [];
  const sqliteVecTarget = vectorTargets.find((target) => target.id === "sqlite-vec");
  if (!sqliteVecTarget) {
    errors.push("VectorStore optionalTargets must include sqlite-vec");
  } else if (sqliteVecTarget.bundled) {
    if (sqliteVecTarget.status !== "allowed") {
      errors.push("Bundled sqlite-vec must be marked allowed");
    }
    const classification = classifyLicenseExpression(sqliteVecTarget.license || "UNKNOWN", manifest?.policy || KNOWLEDGE_LICENSE_POLICY);
    if (classification.status !== "allowed") {
      errors.push(`Bundled sqlite-vec has unallowlisted license ${classification.expression}`);
    }
  } else if (sqliteVecTarget.status !== "not-bundled-license-gated") {
    errors.push("Non-bundled sqlite-vec must be marked not-bundled-license-gated");
  }
  const embeddingTargets = components.EmbeddingRuntime?.optionalTargets || [];
  if (!embeddingTargets.some((target) => target.kind === "ONNX text embedding model" && target.status === "not-bundled-license-gated")) {
    errors.push("EmbeddingRuntime optionalTargets must explicitly mark ONNX model assets as not-bundled-license-gated");
  }
  for (const target of [...vectorTargets, ...embeddingTargets]) {
    if (target.bundled && target.status !== "allowed") {
      errors.push(`${target.id} is bundled but status is ${target.status || "missing"}`);
    }
    if (!target.bundled && target.status === "allowed") {
      warnings.push(`${target.id} is marked allowed but not bundled`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    productionDependencyCount: dependencies.filter((dependency) => dependency.production).length
  };
}

async function writeLicenseManifest(stagingPath, packagingPlan) {
  const manifest = await createKnowledgeLicenseManifest({ stagingPath, packagingPlan });
  const validation = validateKnowledgeLicenseManifest(manifest);
  if (!validation.ok) {
    throw new Error(`License manifest validation failed:\n${validation.errors.map((entry) => `- ${entry}`).join("\n")}`);
  }
  await fs.writeFile(path.join(stagingPath, "license-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

async function verifyUbuntuPackage(stagingPath, target, packagingPlan) {
  console.log("Verifying package inside a clean Ubuntu container without apt...");
  const script = [
    "set -euo pipefail",
    "test -x /pkg/runtime/node/bin/node",
    "/pkg/runtime/node/bin/node -e \"const Database=require('better-sqlite3'); const db=new Database(':memory:'); const row=db.prepare('select 1 as ok').get(); if(row.ok!==1) process.exit(1); db.close();\"",
    packagingPlan.includeTika
      ? "test -x /pkg/modules/jre/linux-x64/bin/java || test -x /pkg/modules/jre/linux-arm64/bin/java"
      : "test ! -d /pkg/modules/jre",
    packagingPlan.includeTika
      ? "/pkg/modules/jre/linux-x64/bin/java -version >/tmp/java-version.log 2>&1 || /pkg/modules/jre/linux-arm64/bin/java -version >/tmp/java-version.log 2>&1"
      : "true",
    "/pkg/bin/start-server --help >/tmp/start-help.log",
    "PACT_SERVER_DATA_DIR=/tmp/pact-data PACT_SERVER_HOST=127.0.0.1 PACT_SERVER_PORT=18787 /pkg/bin/start-server >/tmp/pact-server.log 2>&1 &",
    "pid=$!",
    "trap 'kill $pid 2>/dev/null || true' EXIT",
    "ready=0",
    "for i in {1..60}; do",
    "  if /pkg/runtime/node/bin/node -e \"fetch('http://127.0.0.1:18787/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"; then ready=1; break; fi",
    "  sleep 0.25",
    "done",
    "if [ \"$ready\" != \"1\" ]; then cat /tmp/pact-server.log; exit 1; fi",
    "/pkg/runtime/node/bin/node -e \"fetch('http://127.0.0.1:18787/api/healthz').then(async r=>{const j=await r.json(); console.log(JSON.stringify(j)); if(!r.ok) process.exit(1);}).catch(error=>{console.error(error); process.exit(1);})\""
  ].join("\n");

  await run("docker", [
    "run",
    "--rm",
    "--platform",
    target.dockerPlatform,
    "--env",
    `PATH=${DOCKER_PATH}`,
    "-v",
    `${stagingPath}:/pkg:ro`,
    "-w",
    "/pkg",
    "ubuntu:22.04",
    "bash",
    "-lc",
    script
  ]);
}

async function createArchive(packageRoot, packageName, outputDir) {
  const archivePath = path.join(outputDir, `${packageName}.tar.gz`);
  await fs.rm(archivePath, { force: true });
  await run("tar", ["-czf", archivePath, "-C", outputDir, packageName], {
    env: {
      COPYFILE_DISABLE: "1"
    }
  });
  const sha256 = await sha256File(archivePath);
  await fs.writeFile(`${archivePath}.sha256`, `${sha256}  ${path.basename(archivePath)}\n`, "utf8");
  return { archivePath, sha256 };
}

async function createDryRunReport({
  targetKey,
  target,
  nodeVersion,
  outputDir,
  packageName,
  packagingPlan
}) {
  const nodeArchiveName = `node-v${nodeVersion}-${target.nodePlatform}.tar.xz`;
  const nodeArchivePath = path.join(jreResourceRoot, "downloads", nodeArchiveName);
  const jreArchivePath = path.join(jreResourceRoot, "downloads", target.jreFileName);
  const tikaArchivePath = path.join(tikaResourceRoot, `tika-app-${TIKA_VERSION}.jar`);
  const tikaUrl = `https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar`;
  const licenseManifest = await createKnowledgeLicenseManifest({ packagingPlan });
  const licenseValidation = validateKnowledgeLicenseManifest(licenseManifest);
  if (!licenseValidation.ok) {
    throw new Error(`License manifest validation failed:\n${licenseValidation.errors.map((entry) => `- ${entry}`).join("\n")}`);
  }

  return {
    packageType: "pact.offline-server",
    dryRun: true,
    target: targetKey,
    packageName,
    outputDir,
    offlineManifest: createOfflineManifest(targetKey, nodeVersion, packagingPlan),
    license: {
      ok: true,
      productionDependencyCount: licenseValidation.productionDependencyCount,
      warnings: licenseValidation.warnings
    },
    runtimeAssets: {
      node: {
        url: `https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`,
        cachePath: path.relative(projectRoot, nodeArchivePath),
        cached: await pathExists(nodeArchivePath)
      },
      jre: packagingPlan.includeTika
        ? {
            url: target.jreUrl,
            cachePath: path.relative(projectRoot, jreArchivePath),
            cached: await pathExists(jreArchivePath)
          }
        : null,
      tika: packagingPlan.includeTika
        ? {
            url: tikaUrl,
            cachePath: path.relative(projectRoot, tikaArchivePath),
            cached: await pathExists(tikaArchivePath)
          }
        : null
    },
    wouldBuildConsoleDist: !(await pathExists(path.join(projectRoot, "build", "dist", "index.html"))),
    noAptRequiredAtRuntime: true
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const targetKey = String(args.target || "linux-x64");
  const target = TARGETS[targetKey];
  if (!target) {
    throw new Error(`Unsupported target: ${targetKey}`);
  }

  const nodeVersion = String(args["node-version"] || process.versions.node).replace(/^v/, "");
  if (args["feature-profile"]) {
    args.featureRuntime = resolveFeatureRuntime({
      edition: args.edition || "enterprise",
      profile: JSON.parse(await fs.readFile(path.resolve(String(args["feature-profile"])), "utf8")),
      enableFeatures: args.features,
      disableFeatures: args["without-features"]
    });
  }
  const packagingPlan = createPackagingPlan(args);
  const outputDir = path.resolve(String(args["output-dir"] || path.join("build", "release")));
  const packageName = `pact-server-${targetKey}`;
  const stagingPath = path.join(outputDir, packageName);

  if (args["dry-run"]) {
    const report = await createDryRunReport({
      targetKey,
      target,
      nodeVersion,
      outputDir,
      packageName,
      packagingPlan
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (!(await pathExists(path.join(projectRoot, "build", "dist", "index.html")))) {
    console.log("Building bundled console build/dist ...");
    await run("npm", ["run", "build:renderer"]);
  }

  await fs.rm(stagingPath, { recursive: true, force: true });
  await prepareSourceTree(stagingPath, targetKey, target, nodeVersion, packagingPlan);
  await installLinuxNodeModules(stagingPath, target);
  await writeLicenseManifest(stagingPath, packagingPlan);
  await writeOfflineManifest(stagingPath, targetKey, nodeVersion, packagingPlan);

  if (args["verify-docker"]) {
    await verifyUbuntuPackage(stagingPath, target, packagingPlan);
  }

  const { archivePath, sha256 } = await createArchive(stagingPath, packageName, outputDir);
  if (!args["keep-staging"]) {
    await fs.rm(stagingPath, { recursive: true, force: true });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        packageType: "pact.offline-server",
        target: targetKey,
        archivePath,
        sha256,
        verifiedInUbuntuContainer: Boolean(args["verify-docker"]),
        noAptRequiredAtRuntime: true
      },
      null,
      2
    )}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
