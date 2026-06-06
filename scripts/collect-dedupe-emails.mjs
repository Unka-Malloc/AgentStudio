#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_OUT_DIR = "~/.pact-server-data/evaluation-corpora/mail/messages";
const DEFAULT_REPORT_PATH = "~/.pact-server-data/evaluation-corpora/mail/reports/dedupe-report.json";
const SKIP_DIR_NAMES = new Set([".git", "node_modules"]);
const EMAIL_EXTENSIONS = new Set([".eml"]);

function isMboxPayload(filePath) {
  return path.basename(filePath) === "mbox" && path.basename(path.dirname(filePath)).endsWith(".mbox");
}

function isEmailCorpusFile(filePath) {
  return EMAIL_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || isMboxPayload(filePath);
}

function corpusExtension(filePath) {
  if (isMboxPayload(filePath)) {
    return ".mbox";
  }
  return path.extname(filePath).toLowerCase() || ".eml";
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    outDir: DEFAULT_OUT_DIR,
    reportPath: DEFAULT_REPORT_PATH,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[index + 1] || options.root;
      index += 1;
    } else if (arg === "--out") {
      options.outDir = argv[index + 1] || options.outDir;
      index += 1;
    } else if (arg === "--report") {
      options.reportPath = argv[index + 1] || options.reportPath;
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  options.root = resolveInputPath(options.root, process.cwd());
  options.outDir = resolveInputPath(options.outDir, options.root);
  options.reportPath = resolveInputPath(options.reportPath, options.root);
  return options;
}

function resolveInputPath(inputPath, baseDir) {
  const value = String(inputPath || "").trim();
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(baseDir, value);
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function* walkFiles(root, { outDir }) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || isInside(entryPath, outDir)) {
        continue;
      }
      yield* walkFiles(entryPath, { outDir });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    if (!isEmailCorpusFile(entryPath)) {
      continue;
    }

    yield entryPath;
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function fileSize(filePath) {
  try {
    return (await fsp.stat(filePath)).size;
  } catch {
    return 0;
  }
}

function chooseCanonical(paths, root) {
  return [...paths].sort((left, right) => {
    const leftRelative = path.relative(root, left);
    const rightRelative = path.relative(root, right);
    const leftBuild = leftRelative.startsWith(`build${path.sep}`) ? 1 : 0;
    const rightBuild = rightRelative.startsWith(`build${path.sep}`) ? 1 : 0;
    if (leftBuild !== rightBuild) {
      return leftBuild - rightBuild;
    }
    return leftRelative.localeCompare(rightRelative);
  })[0];
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function moveOrCopy(sourcePath, targetPath, dryRun) {
  if (dryRun) {
    return "dry-run";
  }
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  if (await pathExists(targetPath)) {
    return "exists";
  }

  try {
    await fsp.rename(sourcePath, targetPath);
    return "move";
  } catch {
    await fsp.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    await fsp.rm(sourcePath, { force: true });
    return "copy-remove";
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const groups = new Map();
  let scannedCount = 0;
  let scannedBytes = 0;

  for await (const filePath of walkFiles(options.root, { outDir: options.outDir })) {
    const [hash, size] = await Promise.all([hashFile(filePath), fileSize(filePath)]);
    scannedCount += 1;
    scannedBytes += size;
    const group = groups.get(hash) || {
      hash,
      size,
      paths: []
    };
    group.paths.push(filePath);
    groups.set(hash, group);
    if (scannedCount % 10000 === 0) {
      console.error(`scanned ${scannedCount} email files`);
    }
  }

  const kept = [];
  const removedSources = [];
  let duplicateCount = 0;
  let duplicateBytes = 0;
  let movedCount = 0;
  let movedBytes = 0;

  for (const group of groups.values()) {
    const canonicalPath = chooseCanonical(group.paths, options.root);
    const extension = corpusExtension(canonicalPath);
    const corpusPath = path.join(options.outDir, `${group.hash}${extension}`);
    const corpusAlreadyExists = await pathExists(corpusPath);
    const materializeMode = corpusAlreadyExists
      ? "exists"
      : await moveOrCopy(canonicalPath, corpusPath, options.dryRun);
    const duplicatePaths = corpusAlreadyExists
      ? group.paths
      : group.paths.filter((item) => item !== canonicalPath);

    if (!corpusAlreadyExists) {
      movedCount += 1;
      movedBytes += group.size;
    }

    kept.push({
      hash: group.hash,
      byteSize: group.size,
      originalPath: path.relative(options.root, canonicalPath),
      corpusPath: path.relative(options.root, corpusPath),
      mode: materializeMode,
      duplicateCount: duplicatePaths.length
    });

    for (const duplicatePath of duplicatePaths) {
      const size = await fileSize(duplicatePath);
      duplicateCount += 1;
      duplicateBytes += size;
      removedSources.push({
        hash: group.hash,
        byteSize: size,
        path: path.relative(options.root, duplicatePath),
        reason: corpusAlreadyExists ? "already-in-corpus" : "duplicate-content"
      });
      if (!options.dryRun) {
        await fsp.rm(duplicatePath, { force: true });
      }
    }
  }

  const report = {
    ok: true,
    dryRun: options.dryRun,
    root: options.root,
    outDir: options.outDir,
    scannedCount,
    scannedBytes,
    uniqueCount: groups.size,
    movedCount,
    movedBytes,
    duplicateCount,
    duplicateBytes,
    kept,
    removedSources
  };

  await fsp.mkdir(path.dirname(options.reportPath), { recursive: true });
  await fsp.writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    dryRun: options.dryRun,
    scannedCount,
    uniqueCount: groups.size,
    movedCount,
    duplicateCount,
    duplicateBytes,
    outDir: options.outDir,
    reportPath: options.reportPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
