import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const defaultRepoRoot = path.resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

export const VERSION_SCAN_ROOTS = Object.freeze([
  "server",
  "server-web",
  "mcp-connector",
  "external-services",
  "tests",
  "docs"
]);

export const IGNORED_VERSION_SCAN_PATH_PARTS = Object.freeze([
  ".git",
  "build",
  "node_modules"
]);

export const IGNORED_VERSION_SCAN_FILES = Object.freeze([
  "package-lock.json"
]);

export const GOVERNED_VERSION_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*(?:-[0-9]+(?:\.[0-9]+)*)?(?::[a-z][a-z0-9-]*-[0-9]+(?:\.[0-9]+)*)*$/;

export const GOVERNED_VERSION_TOKEN_PATTERN = /\bv[0-9]+\.[0-9]+\.[0-9]+:[a-zA-Z][a-zA-Z0-9-]*:[a-zA-Z][a-zA-Z0-9-]*(?:-[0-9]+(?:\.[0-9]+)*)?(?::[a-zA-Z][a-zA-Z0-9-]*(?:-[0-9]+(?:\.[0-9]+)*)?)*/g;

export function shouldSkipVersionScanPath(relativePath) {
  if (relativePath.startsWith("docs/reports/history/")) return true;
  if (IGNORED_VERSION_SCAN_FILES.includes(path.basename(relativePath))) return true;
  return relativePath.split("/").some((part) => IGNORED_VERSION_SCAN_PATH_PARTS.includes(part));
}

export function isVersionScanTextFile(filePath) {
  return /\.(?:mjs|js|cjs|ts|tsx|json|md|html|yaml|yml|txt)$/.test(filePath);
}

export function lineAndColumn(text, index) {
  const prefix = text.slice(0, index);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1).length + 1
  };
}

export function collectVersionScanFiles({
  repoRoot = defaultRepoRoot,
  scanRoots = VERSION_SCAN_ROOTS
} = {}) {
  const files = [];

  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      const relativePath = path.relative(repoRoot, filePath).split(path.sep).join("/");
      if (shouldSkipVersionScanPath(relativePath)) continue;
      if (entry.isDirectory()) {
        walk(filePath);
      } else if (entry.isFile() && isVersionScanTextFile(filePath)) {
        files.push(filePath);
      }
    }
  }

  for (const root of scanRoots) {
    walk(path.join(repoRoot, root));
  }
  return files;
}

export function collectGovernedVersionOccurrences({
  repoRoot = defaultRepoRoot,
  scanRoots = VERSION_SCAN_ROOTS
} = {}) {
  const occurrences = new Map();
  for (const filePath of collectVersionScanFiles({ repoRoot, scanRoots })) {
    const relativePath = path.relative(repoRoot, filePath).split(path.sep).join("/");
    const text = fs.readFileSync(filePath, "utf8");
    for (const match of text.matchAll(GOVERNED_VERSION_TOKEN_PATTERN)) {
      const value = match[0];
      if (!occurrences.has(value)) {
        occurrences.set(value, []);
      }
      occurrences.get(value).push({
        relativePath,
        value,
        ...lineAndColumn(text, match.index || 0)
      });
    }
  }
  return occurrences;
}
