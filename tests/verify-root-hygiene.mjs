#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const forbiddenNames = new Set([
  ".DS_Store",
  "artifacts",
  "dist",
  "electron",
  "new",
  "output",
  "page-clients-full.png",
  "portable-client",
  "protocols",
  "public",
  "release",
  "src",
  "testing",
  "tmp",
  ".playwright-cli",
  ".pact-local-data",
  ".pact-agent-history",
  ".pact-server-data",
  ".pact-skill-data",
  ".splitall-server-data",
  ".agentstudio-server-data"
]);

const forbiddenPatterns = [
  /^page-v\d+\.png$/,
  /^page-.+\.png$/,
  /^pact-server-.+\.tar\.gz$/,
  /^pact-server-.+\.tar\.gz\.sha256$/,
  /^.*\.result\.json$/,
  /^.*\.docx$/,
  /^.*\.pdf$/,
  /^.*\.eml$/,
  /^.*\.mbox$/
];

const allowedRootNames = new Set([
  ".dockerignore",
  ".env.example",
  ".gemini",
  ".git",
  ".gitattributes",
  ".gitignore",
  ".github",
  ".kilo",
  ".vscode",
  "AGENT.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "Design.md",
  "Dockerfile",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "SECURITY.md",
  "build",
  "client-cli",
  "client-gui",
  "docker-compose.yml",
  "docs",
  "external-services",
  "mcp-connector",
  "modules",
  "node_modules",
  "reports",
  "scripts",
  "package-lock.json",
  "package.json",
  "server",
  "server-web",
  "skills",
  "pact-v1",
  "tests",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts"
]);

const sourceRootsToScan = [
  "docs",
  "scripts",
  "server",
  "server-web",
  "client-cli",
  "client-gui",
  "skills",
  "tests"
];

const nestedScanExcludedPaths = new Set([
  "client-cli/target",
  "client-gui/.dart_tool",
  "client-gui/build",
  "client-gui/linux/flutter/ephemeral",
  "client-gui/macos/Flutter/ephemeral",
  "client-gui/macos/Pods",
  "client-gui/windows/flutter/ephemeral",
  "tests/fixtures"
]);

const nestedGeneratedNames = new Set([".DS_Store", "__pycache__"]);
const nestedGeneratedPatterns = [/\.pyc$/u, /\.pyo$/u, /\.pyd$/u, /\.eml$/u, /\.mbox$/u];
const forbiddenNestedPaths = new Set([
  "server/communication",
  "client-cli/communication",
  "tests/email-corpus"
]);
const dataDirPolicyExcludedPaths = new Set([
  "server/platform/common/config/ServerConfig.mjs",
  "tests/verify-root-hygiene.mjs"
]);
const forbiddenDataDirDefaultPatterns = [
  /path\.(?:join|resolve)\(\s*projectRoot\s*,\s*["']\.pact-server-data["']\s*\)/u,
  /path\.(?:join|resolve)\(\s*process\.cwd\(\)\s*,\s*["']\.pact-server-data["']\s*\)/u,
  /path\.(?:join|resolve)\(\s*repoRoot\(\)\s*,\s*["']\.pact-server-data["']\s*\)/u,
  /DATA_DIR=["']\$PROJECT_ROOT\/\.pact-server-data["']/u,
  /path\.(?:join|resolve)\(\s*projectRoot\s*,\s*["']\.cache["']/u,
  /userDataPath\s*\|\|\s*process\.cwd\(\)/u,
  /options\.userDataPath\s*\|\|\s*process\.cwd\(\)/u,
  /default:\s*\.\/?\.pact-server-data/iu,
  /默认数据目录：\s*`?\.pact-server-data/u
];

const repositoryWideCredentialScanExcludedPaths = new Set([
  ".git",
  "node_modules",
  ".kilo/node_modules",
  "client-cli/target",
  "client-gui/.dart_tool",
  "client-gui/build",
  "client-gui/linux/flutter/ephemeral",
  "client-gui/macos/Flutter/ephemeral",
  "client-gui/macos/Pods",
  "client-gui/windows/flutter/ephemeral",
  "server/platform/modules/knowledge/runtime/jre",
  "build/release/mcp"
]);

const forbiddenCredentialStateDirNames = new Set([
  ".pact-local-data",
  ".pact-server-data",
  ".pact-skill-data",
  ".splitall-server-data",
  ".agentstudio-server-data",
  "server-data",
  "local-data",
  "mailapp-full-download",
  "mail-imports"
]);

const forbiddenCredentialFileNames = new Set([
  ".sealing-key",
  "csrf-hmac-secret.bin",
  "credentials.json",
  "token.json",
  "tokens.json"
]);

const forbiddenCredentialFilePatterns = [
  /(^|\/)\.env(?:\.[^/]+)?$/iu,
  /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/iu,
  /(^|\/)(?:client_secret|service-account|service_account|api-key|apikey|auth-token|access-token|refresh-token)[^/]*\.(?:json|yaml|yml|txt|env)$/iu,
  /(^|\/)(?:private|secret|client_secret)[^/]*\.pem$/iu,
  /\.(?:key|p12|pfx|jks|keystore)$/iu
];

const forbiddenRuntimeConfigFileNames = new Set([
  "settings.json",
  "knowledge-backends.json",
  "codespace-providers.json",
  "cloud-drive-connections.json",
  "mount-modules.json",
  "mount-routing.json"
]);

const forbiddenProjectRuntimeDefaultPatterns = [
  /["']build\/(?:server-data|local-data)(?:\/|["'])/u,
  /["']\.\/build\/(?:server-data|local-data)(?:\/|["'])/u
];

const placeholderPathPolicyExcludedPaths = new Set([
  "docs/reports/history",
  "tests/fixtures",
  "tests/verify-root-hygiene.mjs"
]);

const placeholderPathScanRoots = [
  "README.md",
  "README.zh-CN.md",
  "package.json",
  "docs",
  "scripts",
  "server",
  "server-web",
  "client-cli",
  "client-gui",
  "skills",
  "tests",
  "external-services",
  "mcp-connector"
];

const placeholderPathScanExtensions = new Set([
  "",
  ".css",
  ".dart",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml"
]);

const forbiddenPlaceholderPathPatterns = [
  {
    id: "nonexistent-placeholder-path",
    pattern: new RegExp("\\/" + "nonexistent(?:\\/|[\"'`\\s]|$)", "u")
  },
  {
    id: "placeholder-path-variable",
    pattern: new RegExp("\\bf" + "ake[A-Za-z0-9_]*(?:Path|Dir|Bin|Root|Home|Workspace)\\b", "u")
  },
  {
    id: "placeholder-named-path-segment",
    pattern: new RegExp("[\"'`][^\"'`\\n]*(?:^|[/_-])f" + "ake(?:[/_-]|[A-Z])[^\"'`\\n]*[\"'`]", "iu")
  }
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function shouldSkipNestedScan(relativePath) {
  const normalized = toPosix(relativePath);
  for (const excludedPath of nestedScanExcludedPaths) {
    if (normalized === excludedPath || normalized.startsWith(`${excludedPath}/`)) {
      return true;
    }
  }
  return false;
}

function shouldSkipRepositoryWideCredentialScan(relativePath) {
  const normalized = toPosix(relativePath);
  for (const excludedPath of repositoryWideCredentialScanExcludedPaths) {
    if (normalized === excludedPath || normalized.startsWith(`${excludedPath}/`)) {
      return true;
    }
  }
  return false;
}

function isPlaceholderCredentialPath(relativePath) {
  const basename = path.basename(relativePath).toLowerCase();
  return (
    basename.endsWith(".example") ||
    basename.endsWith("-example") ||
    basename.endsWith(".sample") ||
    basename.endsWith("-sample") ||
    basename.endsWith(".template") ||
    basename.endsWith("-template") ||
    basename === ".env.example"
  );
}

function isProjectLocalRuntimeConfigPath(relativePath) {
  const normalized = toPosix(relativePath);
  if (!normalized.startsWith("build/")) {
    return false;
  }
  return forbiddenRuntimeConfigFileNames.has(path.basename(normalized));
}

function shouldSkipPlaceholderPathPolicy(relativePath) {
  const normalized = toPosix(relativePath);
  for (const excludedPath of placeholderPathPolicyExcludedPaths) {
    if (normalized === excludedPath || normalized.startsWith(`${excludedPath}/`)) {
      return true;
    }
  }
  return shouldSkipNestedScan(normalized);
}

function shouldScanPlaceholderPathFile(relativePath) {
  const basename = path.basename(relativePath);
  if (basename === "Dockerfile") {
    return true;
  }
  return placeholderPathScanExtensions.has(path.extname(relativePath));
}

function lineNumberForOffset(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

async function scanRepositoryWideCredentialState(directory, relativePath, violations) {
  if (shouldSkipRepositoryWideCredentialScan(relativePath)) {
    return;
  }

  let entriesForDirectory;
  try {
    entriesForDirectory = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entriesForDirectory) {
    const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    const normalizedChildPath = toPosix(childRelativePath);

    if (shouldSkipRepositoryWideCredentialScan(normalizedChildPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (forbiddenCredentialStateDirNames.has(entry.name)) {
        violations.push(`${normalizedChildPath}/`);
        continue;
      }
      await scanRepositoryWideCredentialState(
        path.join(directory, entry.name),
        childRelativePath,
        violations
      );
      continue;
    }

    if (!entry.isFile() || isPlaceholderCredentialPath(normalizedChildPath)) {
      continue;
    }

    if (
      forbiddenCredentialFileNames.has(entry.name) ||
      isProjectLocalRuntimeConfigPath(normalizedChildPath) ||
      forbiddenCredentialFilePatterns.some((pattern) => pattern.test(normalizedChildPath))
    ) {
      violations.push(normalizedChildPath);
    }
  }
}

async function scanNestedGeneratedArtifacts(directory, relativePath, generatedArtifacts) {
  let entriesForDirectory;
  try {
    entriesForDirectory = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entriesForDirectory) {
    const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    const normalizedChildPath = toPosix(childRelativePath);

    if (shouldSkipNestedScan(normalizedChildPath)) {
      continue;
    }

    if (forbiddenNestedPaths.has(normalizedChildPath)) {
      generatedArtifacts.add(normalizedChildPath);
      continue;
    }

    if (nestedGeneratedNames.has(entry.name)) {
      generatedArtifacts.add(normalizedChildPath);
      continue;
    }

    if (entry.isDirectory()) {
      await scanNestedGeneratedArtifacts(
        path.join(directory, entry.name),
        childRelativePath,
        generatedArtifacts
      );
      continue;
    }

    if (nestedGeneratedPatterns.some((pattern) => pattern.test(entry.name))) {
      generatedArtifacts.add(normalizedChildPath);
    }
  }
}

function findDuplicateJsonObjectKeys(source, relativePath) {
  const duplicates = [];
  const stack = [];
  let index = 0;
  let line = 1;

  function currentObject() {
    const current = stack[stack.length - 1];
    return current?.type === "object" ? current : null;
  }

  function readString() {
    const startLine = line;
    let value = "";
    index += 1;
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") {
        value += char;
        index += 2;
        continue;
      }
      if (char === "\"") {
        index += 1;
        return { value, line: startLine };
      }
      if (char === "\n") {
        line += 1;
      }
      value += char;
      index += 1;
    }
    return { value, line: startLine };
  }

  while (index < source.length) {
    const char = source[index];
    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === "{") {
      stack.push({ type: "object", keys: new Map(), expectingKey: true });
      index += 1;
      continue;
    }
    if (char === "}") {
      stack.pop();
      index += 1;
      continue;
    }
    if (char === "[") {
      stack.push({ type: "array" });
      index += 1;
      continue;
    }
    if (char === "]") {
      stack.pop();
      index += 1;
      continue;
    }
    if (char === ",") {
      const object = currentObject();
      if (object) {
        object.expectingKey = true;
      }
      index += 1;
      continue;
    }
    if (char === ":") {
      const object = currentObject();
      if (object) {
        object.expectingKey = false;
      }
      index += 1;
      continue;
    }
    if (char === "\"") {
      const token = readString();
      const object = currentObject();
      if (object?.expectingKey) {
        if (object.keys.has(token.value)) {
          duplicates.push({
            file: relativePath,
            key: token.value,
            firstLine: object.keys.get(token.value),
            line: token.line
          });
        } else {
          object.keys.set(token.value, token.line);
        }
        object.expectingKey = false;
      }
      continue;
    }
    index += 1;
  }

  return duplicates;
}

async function scanSourceFiles(directory, relativePath, visitor) {
  let entriesForDirectory;
  try {
    entriesForDirectory = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entriesForDirectory) {
    const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    const normalizedChildPath = toPosix(childRelativePath);
    if (shouldSkipNestedScan(normalizedChildPath)) {
      continue;
    }
    const childPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scanSourceFiles(childPath, childRelativePath, visitor);
      continue;
    }
    await visitor(childPath, normalizedChildPath);
  }
}

async function scanPlaceholderPathPolicyEntry(absolutePath, relativePath, violations) {
  const normalizedPath = toPosix(relativePath);
  if (shouldSkipPlaceholderPathPolicy(normalizedPath)) {
    return;
  }
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isDirectory()) {
    const entriesForDirectory = await fs.readdir(absolutePath, { withFileTypes: true });
    for (const entry of entriesForDirectory) {
      await scanPlaceholderPathPolicyEntry(
        path.join(absolutePath, entry.name),
        relativePath ? path.join(relativePath, entry.name) : entry.name,
        violations
      );
    }
    return;
  }
  if (!stat.isFile() || !shouldScanPlaceholderPathFile(normalizedPath)) {
    return;
  }
  const text = await fs.readFile(absolutePath, "utf8").catch(() => "");
  for (const { id, pattern } of forbiddenPlaceholderPathPatterns) {
    const match = pattern.exec(text);
    if (match) {
      violations.push(`${id}: ${normalizedPath}:${lineNumberForOffset(text, match.index)}`);
    }
  }
}

async function assertPackageJsonHasNoDuplicateKeys() {
  const relativePath = "package.json";
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  const duplicates = findDuplicateJsonObjectKeys(source, relativePath);
  if (duplicates.length === 0) {
    return;
  }
  const lines = ["Duplicate JSON object keys:"];
  for (const duplicate of duplicates) {
    lines.push(
      `- ${duplicate.file}:${duplicate.line} duplicates "${duplicate.key}" first declared at line ${duplicate.firstLine}`
    );
  }
  throw new Error(lines.join("\n"));
}

async function assertServerDataDirPolicy() {
  const violations = [];
  for (const scanRoot of ["docs", "scripts", "server", "tests"]) {
    await scanSourceFiles(path.join(root, scanRoot), scanRoot, async (filePath, relativePath) => {
      if (dataDirPolicyExcludedPaths.has(relativePath)) {
        return;
      }
      const text = await fs.readFile(filePath, "utf8");
      const lines = text.split(/\n/u);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (forbiddenDataDirDefaultPatterns.some((pattern) => pattern.test(lines[lineIndex]))) {
          violations.push(`${relativePath}:${lineIndex + 1}: ${lines[lineIndex].trim()}`);
        }
      }
    });
  }
  if (violations.length === 0) {
    return;
  }
  throw new Error(
    [
      "Server data dir defaults must resolve through ServerConfig.getDataDir().",
      "Explicit --data-dir overrides are allowed; do not default to a project-local .pact-server-data.",
      ...violations.map((violation) => `- ${violation}`)
    ].join("\n")
  );
}

async function assertNoProjectLocalRuntimeState() {
  const violations = [];
  await scanRepositoryWideCredentialState(root, "", violations);
  if (violations.length === 0) {
    return;
  }
  throw new Error(
    [
      "Project-local runtime or credential state is forbidden.",
      "Do not store keys, tokens, secret values, runtime settings, provider manifests, or local Pact data dirs anywhere under the repository.",
      "Use ~/.pact-server-data for server data/config and OS/env secret stores for credential values.",
      ...violations.sort().map((violation) => `- ${violation}`)
    ].join("\n")
  );
}

async function assertNoProjectLocalRuntimeDefaults() {
  const violations = [];
  for (const scanRoot of ["server", "scripts"]) {
    await scanSourceFiles(path.join(root, scanRoot), scanRoot, async (filePath, relativePath) => {
      const text = await fs.readFile(filePath, "utf8");
      const lines = text.split(/\n/u);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (forbiddenProjectRuntimeDefaultPatterns.some((pattern) => pattern.test(lines[lineIndex]))) {
          violations.push(`${relativePath}:${lineIndex + 1}: ${lines[lineIndex].trim()}`);
        }
      }
    });
  }
  if (violations.length === 0) {
    return;
  }
  throw new Error(
    [
      "Runtime defaults must not point into project-local build/server-data or build/local-data.",
      "Use ServerConfig.getDataDir() / ~/.pact-server-data for runtime config and state.",
      ...violations.map((violation) => `- ${violation}`)
    ].join("\n")
  );
}

async function assertNoPlaceholderPathArtifacts() {
  const violations = [];
  for (const scanRoot of placeholderPathScanRoots) {
    await scanPlaceholderPathPolicyEntry(path.join(root, scanRoot), scanRoot, violations);
  }
  if (violations.length === 0) {
    return;
  }
  throw new Error(
    [
      "Placeholder paths and nonexistent path literals are forbidden in active project files.",
      "Use real temporary fixture paths created by the test, or a real external data/config directory.",
      "Archived history and raw external fixture corpora are excluded from this gate.",
      ...violations.sort().map((violation) => `- ${violation}`)
    ].join("\n")
  );
}

const entries = await fs.readdir(root, { withFileTypes: true });
const violations = [];
const unknown = [];
const generatedArtifacts = new Set();

for (const entry of entries) {
  const name = entry.name;
  if (forbiddenNames.has(name) || forbiddenPatterns.some((pattern) => pattern.test(name))) {
    violations.push(name);
    continue;
  }
  if (!allowedRootNames.has(name)) {
    unknown.push(name);
  }
}

for (const sourceRoot of sourceRootsToScan) {
  await scanNestedGeneratedArtifacts(path.join(root, sourceRoot), sourceRoot, generatedArtifacts);
}

if (violations.length > 0 || unknown.length > 0 || generatedArtifacts.size > 0) {
  const lines = [];
  if (violations.length > 0) {
    lines.push("Forbidden root entries:");
    for (const name of violations.sort()) {
      lines.push(`- ${name}`);
    }
  }
  if (unknown.length > 0) {
    lines.push("Unclassified root entries:");
    for (const name of unknown.sort()) {
      lines.push(`- ${name}`);
    }
  }
  if (generatedArtifacts.size > 0) {
    lines.push("Forbidden generated source-tree entries:");
    for (const name of [...generatedArtifacts].sort()) {
      lines.push(`- ${name}`);
    }
  }
  lines.push("");
  lines.push("Move generated output under build/, project docs under docs/, and small synthetic repository fixtures under tests/.");
  lines.push("Keep downloaded evaluation corpora, real mailboxes, imported messages, and real document sample sets under ~/.pact-server-data/evaluation-corpora/.");
  lines.push("Keep protocol documents under the owning layer, for example server/protocols, client-cli/protocols, or server-web/protocols.");
  lines.push("Do not recreate server/communication or client-cli/communication; protocol execution adapters belong under the matching protocols tree.");
  lines.push("Remove OS and interpreter cache files from source, docs, and protocol directories.");
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

await assertPackageJsonHasNoDuplicateKeys();
await assertServerDataDirPolicy();
await assertNoProjectLocalRuntimeDefaults();
await assertNoProjectLocalRuntimeState();
await assertNoPlaceholderPathArtifacts();

process.stdout.write("Root path hygiene passed.\n");
