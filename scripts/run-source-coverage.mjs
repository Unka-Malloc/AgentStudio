import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_ROOT = path.join(REPO_ROOT, "src");
const TEST_ROOT = path.join(REPO_ROOT, "tests", "pactium");
const EXCLUDED_SOURCE_PATHS = new Set([
  "src/http.js",
  "src/canonical/safe-value.js",
  "src/storage/data-dir-preflight.js"
]);
const THRESHOLDS = Object.freeze({ lines: 95, branches: 87, functions: 95 });
const COVERAGE_FILE = /^coverage-\d+-\d{13}-\d+\.json$/u;
const IGNORE_NEXT = /\/\* node:coverage ignore next (?<count>\d+ )?\*\//u;
const COVERAGE_STATUS = /\/\* node:coverage (?<status>enable|disable) \*\//u;

function cloneRange(range) {
  return {
    startOffset: Number(range.startOffset),
    endOffset: Number(range.endOffset),
    count: Number(range.count) || 0
  };
}

function rootRange(fn) {
  return fn?.ranges?.[0] || null;
}

function functionKey(fn) {
  const root = rootRange(fn);
  return root ? `${Number(root.startOffset)}:${Number(root.endOffset)}` : "";
}

function mergeRanges(target, ranges) {
  for (const raw of ranges || []) {
    const range = cloneRange(raw);
    const key = `${range.startOffset}:${range.endOffset}`;
    const current = target.get(key);
    if (!current) target.set(key, range);
    else current.count = Math.max(current.count, range.count);
  }
}

export function mergeCoverageScripts(processCoverages) {
  const scripts = new Map();
  for (const coverage of processCoverages) {
    for (const rawScript of coverage?.result || []) {
      const normalizedUrl = normalizeSourceUrl(rawScript.url);
      if (!normalizedUrl) continue;
      let script = scripts.get(normalizedUrl);
      if (!script) {
        script = { url: normalizedUrl, functions: new Map() };
        scripts.set(normalizedUrl, script);
      }
      for (const rawFunction of rawScript.functions || []) {
        const key = functionKey(rawFunction);
        if (!key) continue;
        let fn = script.functions.get(key);
        if (!fn) {
          fn = {
            functionName: String(rawFunction.functionName || ""),
            isBlockCoverage: Boolean(rawFunction.isBlockCoverage),
            ranges: new Map()
          };
          script.functions.set(key, fn);
          mergeRanges(fn.ranges, rawFunction.ranges);
          continue;
        }
        if (!fn.functionName && rawFunction.functionName) fn.functionName = String(rawFunction.functionName);
        if (rawFunction.isBlockCoverage && !fn.isBlockCoverage) {
          fn.isBlockCoverage = true;
          fn.ranges.clear();
          mergeRanges(fn.ranges, rawFunction.ranges);
        } else if (rawFunction.isBlockCoverage === fn.isBlockCoverage) {
          mergeRanges(fn.ranges, rawFunction.ranges);
        }
      }
    }
  }
  return [...scripts.values()]
    .map((script) => ({
      url: script.url,
      functions: [...script.functions.values()].map((fn) => ({
        functionName: fn.functionName,
        isBlockCoverage: fn.isBlockCoverage,
        ranges: [...fn.ranges.values()].sort(compareRanges)
      })).sort(compareFunctions)
    }))
    .sort((left, right) => left.url.localeCompare(right.url));
}

function compareRanges(left, right) {
  return left.startOffset - right.startOffset || right.endOffset - left.endOffset;
}

function compareFunctions(left, right) {
  return compareRanges(rootRange(left), rootRange(right));
}

function normalizeSourceUrl(rawUrl) {
  if (!String(rawUrl || "").startsWith("file:")) return "";
  let absolutePath;
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    absolutePath = path.resolve(fileURLToPath(url));
  } catch {
    return "";
  }
  const relativePath = path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
  if (relativePath.startsWith("../") || relativePath === "..") return "";
  if (!absolutePath.startsWith(`${SOURCE_ROOT}${path.sep}`) || EXCLUDED_SOURCE_PATHS.has(relativePath)) return "";
  return pathToFileURL(absolutePath).href;
}

function sourceLines(source) {
  const split = source.split(/(?<=\r?\n)/u);
  let ignoreCount = 0;
  let enabled = true;
  let offset = 0;
  return split.map((text, index) => {
    const newlineLength = text.match(/\r?\n$/u)?.[0].length || 0;
    const line = {
      line: index + 1,
      startOffset: offset,
      endOffset: offset + text.length - newlineLength,
      ignore: ignoreCount > 0 || !enabled,
      count: text.length === newlineLength ? 1 : 0
    };
    offset += text.length;
    if (ignoreCount > 0) ignoreCount -= 1;
    else if (enabled) {
      const match = text.match(IGNORE_NEXT);
      if (match) ignoreCount = Number.parseInt(match.groups?.count || "1", 10);
    }
    const status = text.match(COVERAGE_STATUS)?.groups?.status;
    if (status) {
      ignoreCount = 0;
      enabled = status === "enable";
    }
    return line;
  });
}

function mapRangeToLines(range, lines) {
  const mapped = [];
  for (const line of lines) {
    if (range.endOffset <= line.startOffset) break;
    if (range.startOffset >= line.endOffset) continue;
    if (range.startOffset <= line.startOffset && range.endOffset >= line.endOffset) {
      line.count = range.count;
    }
    mapped.push(line);
  }
  return mapped;
}

function percentage(covered, total) {
  return total === 0 ? 100 : covered / total * 100;
}

export function summarizeSource(source, functions) {
  const lines = sourceLines(source);
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  for (const [functionIndex, fn] of [...functions].sort(compareFunctions).entries()) {
    let maxCount = 0;
    let rootLines = [];
    for (const [rangeIndex, range] of [...fn.ranges].sort(compareRanges).entries()) {
      maxCount = Math.max(maxCount, range.count);
      const mapped = mapRangeToLines(range, lines);
      if (rangeIndex === 0) rootLines = mapped;
      if (fn.isBlockCoverage) {
        totalBranches += 1;
        if (range.count > 0 || mapped.every((line) => line.ignore)) coveredBranches += 1;
      }
    }
    if (functionIndex > 0 && fn.ranges.length > 0) {
      totalFunctions += 1;
      if (maxCount > 0 || rootLines.every((line) => line.ignore)) coveredFunctions += 1;
    }
  }
  const coveredLines = lines.filter((line) => line.count > 0 || line.ignore).length;
  return {
    totalLines: lines.length,
    coveredLines,
    totalBranches,
    coveredBranches,
    totalFunctions,
    coveredFunctions
  };
}

async function readRawCoverage(directory) {
  const coverages = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !COVERAGE_FILE.test(entry.name)) continue;
    coverages.push(JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8")));
  }
  return coverages;
}

async function runTests(coverageDirectory) {
  const tests = (await fs.readdir(TEST_ROOT))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join("tests", "pactium", name));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...tests], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_V8_COVERAGE: coverageDirectory },
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Pactium test process terminated by signal ${signal}.`));
      else resolve(Number(code));
    });
  });
}

function addTotals(total, value) {
  for (const key of Object.keys(total)) total[key] += value[key];
}

function report(rows, totals) {
  const format = (covered, total) => percentage(covered, total).toFixed(2).padStart(6);
  console.log("\nsource-only deterministic coverage");
  console.log("file                                      | line % | branch % | funcs %");
  for (const row of rows) {
    console.log(`${row.path.padEnd(41)} | ${format(row.coveredLines, row.totalLines)} | ${format(row.coveredBranches, row.totalBranches)} | ${format(row.coveredFunctions, row.totalFunctions)}`);
  }
  console.log(`${"all files".padEnd(41)} | ${format(totals.coveredLines, totals.totalLines)} | ${format(totals.coveredBranches, totals.totalBranches)} | ${format(totals.coveredFunctions, totals.totalFunctions)}`);
  console.log(`covered/total                              | ${totals.coveredLines}/${totals.totalLines} | ${totals.coveredBranches}/${totals.totalBranches} | ${totals.coveredFunctions}/${totals.totalFunctions}`);
}

async function main() {
  const coverageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "pactium-source-coverage-"));
  try {
    const testStatus = await runTests(coverageDirectory);
    if (testStatus !== 0) process.exitCode = testStatus;
    const scripts = mergeCoverageScripts(await readRawCoverage(coverageDirectory));
    const rows = [];
    const totals = {
      totalLines: 0,
      coveredLines: 0,
      totalBranches: 0,
      coveredBranches: 0,
      totalFunctions: 0,
      coveredFunctions: 0
    };
    for (const script of scripts) {
      const source = await fs.readFile(fileURLToPath(script.url), "utf8");
      const summary = summarizeSource(source, script.functions);
      addTotals(totals, summary);
      rows.push({ path: path.relative(REPO_ROOT, fileURLToPath(script.url)).split(path.sep).join("/"), ...summary });
    }
    report(rows, totals);
    const actual = {
      lines: percentage(totals.coveredLines, totals.totalLines),
      branches: percentage(totals.coveredBranches, totals.totalBranches),
      functions: percentage(totals.coveredFunctions, totals.totalFunctions)
    };
    const failed = Object.entries(THRESHOLDS).filter(([name, threshold]) => actual[name] < threshold);
    if (failed.length > 0) {
      for (const [name, threshold] of failed) {
        console.error(`${name} coverage ${actual[name].toFixed(2)}% does not meet threshold ${threshold}%.`);
      }
      process.exitCode = 1;
    }
  } finally {
    await fs.rm(coverageDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
