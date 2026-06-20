#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const releaseSections = ["added", "changed", "fixed", "security", "removed"];
const sectionTitles = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  security: "Security",
  removed: "Removed"
};

function usage() {
  process.stdout.write(`Usage:
  npm run release:prepare -- <version> [options]

Examples:
  npm run release:prepare -- 0.2.3 --summary "This patch release tightens local release automation." --changed "Added one-command release preparation."
  npm run release:prepare -- 0.2.3 --no-fixtures
  npm run release:prepare -- 0.2.3 --verify

Options:
  --summary TEXT          Release summary for CHANGELOG.md.
  --date YYYY-MM-DD      Release date. Defaults to the local calendar date.
  --added TEXT           Add a CHANGELOG.md Added bullet. Repeatable.
  --changed TEXT         Add a CHANGELOG.md Changed bullet. Repeatable.
  --fixed TEXT           Add a CHANGELOG.md Fixed bullet. Repeatable.
  --security TEXT        Add a CHANGELOG.md Security bullet. Repeatable.
  --removed TEXT         Add a CHANGELOG.md Removed bullet. Repeatable.
  --no-changelog         Skip CHANGELOG.md entry creation.
  --no-fixtures          Skip protocol fixture refresh.
  --check-registry       Fail if pactium@<version> already exists on npm.
  --verify               Run npm run verify:release after preparation.
  --allow-same-version   Allow preparing the current package.json version.
  --dry-run              Print the planned changes without writing files.
`);
}

function localDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function takeValue(args, index, option) {
  const current = args[index];
  const prefix = `${option}=`;
  if (current.startsWith(prefix)) return { value: current.slice(prefix.length), nextIndex: index };
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return { value, nextIndex: index + 1 };
}

function parseArgs(argv) {
  const parsed = {
    version: "",
    summary: "",
    date: localDate(),
    changelog: true,
    fixtures: true,
    checkRegistry: false,
    verify: false,
    allowSameVersion: false,
    dryRun: false,
    entries: Object.fromEntries(releaseSections.map((section) => [section, []]))
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (!arg.startsWith("--")) {
      if (parsed.version) throw new Error(`Unexpected positional argument: ${arg}`);
      parsed.version = arg;
      continue;
    }
    if (arg === "--no-changelog") {
      parsed.changelog = false;
      continue;
    }
    if (arg === "--no-fixtures") {
      parsed.fixtures = false;
      continue;
    }
    if (arg === "--check-registry") {
      parsed.checkRegistry = true;
      continue;
    }
    if (arg === "--verify") {
      parsed.verify = true;
      continue;
    }
    if (arg === "--allow-same-version") {
      parsed.allowSameVersion = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--summary" || arg.startsWith("--summary=")) {
      const result = takeValue(argv, index, "--summary");
      parsed.summary = result.value.trim();
      index = result.nextIndex;
      continue;
    }
    if (arg === "--date" || arg.startsWith("--date=")) {
      const result = takeValue(argv, index, "--date");
      parsed.date = result.value.trim();
      index = result.nextIndex;
      continue;
    }
    const section = releaseSections.find((candidate) => arg === `--${candidate}` || arg.startsWith(`--${candidate}=`));
    if (section) {
      const result = takeValue(argv, index, `--${section}`);
      parsed.entries[section].push(result.value.trim());
      index = result.nextIndex;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Release version must be plain semver major.minor.patch, got: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function isPatchBump(currentVersion, targetVersion) {
  const current = parseVersion(currentVersion);
  const target = parseVersion(targetVersion);
  return current[0] === target[0] && current[1] === target[1] && target[2] >= current[2];
}

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Release date must be YYYY-MM-DD, got: ${date}`);
  }
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function writeText(relativePath, text, dryRun, changed) {
  const absolutePath = path.join(root, relativePath);
  const current = await fs.readFile(absolutePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (current === text) return;
  changed.add(relativePath);
  if (!dryRun) await fs.writeFile(absolutePath, text);
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function writeJson(relativePath, value, dryRun, changed) {
  await writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`, dryRun, changed);
}

async function replaceOne(relativePath, pattern, replacement, dryRun, changed) {
  const current = await readText(relativePath);
  const matches = current.match(pattern) || [];
  if (matches.length !== 1) {
    throw new Error(`${relativePath} expected exactly one match for ${pattern}, found ${matches.length}.`);
  }
  await writeText(relativePath, current.replace(pattern, replacement), dryRun, changed);
}

function defaultChangelogSummary(currentVersion, targetVersion) {
  if (isPatchBump(currentVersion, targetVersion)) {
    return `This patch release prepares Pactium ${targetVersion}. It does not change the protocol version or public API shape.`;
  }
  throw new Error("Non-patch releases require --summary and at least one changelog bullet.");
}

function hasChangelogBullets(entries) {
  return releaseSections.some((section) => entries[section].length > 0);
}

function changelogEntry({ version, date, summary, entries }) {
  const sections = releaseSections
    .filter((section) => entries[section].length > 0)
    .map((section) => [
      `### ${sectionTitles[section]}`,
      "",
      ...entries[section].map((item) => `- ${item}`)
    ].join("\n"))
    .join("\n\n");
  return `## [${version}] - ${date}\n\n${summary}\n\n${sections}\n\n`;
}

async function updateChangelog({ version, currentVersion, date, summary, entries }, dryRun, changed) {
  const relativePath = "CHANGELOG.md";
  const current = await readText(relativePath);
  if (current.includes(`## [${version}]`)) return;

  const nextEntries = Object.fromEntries(releaseSections.map((section) => [section, [...entries[section]]]));
  let nextSummary = summary;
  if (!nextSummary && !hasChangelogBullets(nextEntries)) {
    nextSummary = defaultChangelogSummary(currentVersion, version);
    nextEntries.changed.push("Synchronized package metadata, public version constants, published documentation, and protocol regression fixtures for the release.");
  } else if (!nextSummary) {
    throw new Error("CHANGELOG.md entry requires --summary when changelog bullets are provided.");
  } else if (!hasChangelogBullets(nextEntries)) {
    nextEntries.changed.push("Synchronized release metadata and generated release fixtures.");
  }

  const intro = "The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).\n\n";
  if (!current.includes(intro)) {
    throw new Error("CHANGELOG.md introduction marker was not found.");
  }
  let next = current.replace(intro, `${intro}${changelogEntry({
    version,
    date,
    summary: nextSummary,
    entries: nextEntries
  })}`);

  const releaseRef = `[${version}]: https://github.com/Unka-Malloc/Pactium/releases/tag/v${version}`;
  if (!next.includes(`[${version}]:`)) {
    const firstReference = /\n\[\d+\.\d+\.\d+\]: /;
    if (firstReference.test(next)) {
      next = next.replace(firstReference, `\n${releaseRef}$&`);
    } else {
      next = `${next.trimEnd()}\n\n${releaseRef}\n`;
    }
  }

  await writeText(relativePath, next, dryRun, changed);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env || {})
    }
  });
  if (result.status !== 0) {
    const output = options.capture ? `\n${result.stdout || ""}${result.stderr || ""}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}.${output}`);
  }
  return result;
}

function checkRegistry(version) {
  const result = spawnSync("npm", [
    "view",
    `pactium@${version}`,
    "version",
    "--registry=https://registry.npmjs.org/",
    "--fetch-timeout=10000"
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.status === 0) {
    throw new Error(`pactium@${version} already exists on npm.`);
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!/E404|404|No match found/i.test(output)) {
    throw new Error(`Unable to confirm pactium@${version} is unpublished on npm.${output ? `\n${output}` : ""}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.version) {
    usage();
    throw new Error("Missing release version.");
  }
  validateDate(options.date);
  const changed = new Set();
  const packageJson = await readJson("package.json");
  const currentVersion = packageJson.version;
  const comparison = compareVersions(options.version, currentVersion);
  if (comparison < 0 || (comparison === 0 && !options.allowSameVersion)) {
    throw new Error(`Target version ${options.version} must be newer than package.json version ${currentVersion}.`);
  }
  if (options.checkRegistry) checkRegistry(options.version);

  packageJson.version = options.version;
  await writeJson("package.json", packageJson, options.dryRun, changed);

  const packageLock = await readJson("package-lock.json");
  packageLock.version = options.version;
  if (!packageLock.packages?.[""]) {
    throw new Error("package-lock.json missing root packages entry.");
  }
  packageLock.packages[""].version = options.version;
  await writeJson("package-lock.json", packageLock, options.dryRun, changed);

  await replaceOne(
    "src/protocol/constants.js",
    /export const PACTIUM_PACKAGE_VERSION = "\d+\.\d+\.\d+";/g,
    `export const PACTIUM_PACKAGE_VERSION = "${options.version}";`,
    options.dryRun,
    changed
  );
  await replaceOne(
    "src/index.d.ts",
    /export const PACTIUM_PACKAGE_VERSION: "\d+\.\d+\.\d+";/g,
    `export const PACTIUM_PACKAGE_VERSION: "${options.version}";`,
    options.dryRun,
    changed
  );

  if (options.changelog) {
    await updateChangelog({
      version: options.version,
      currentVersion,
      date: options.date,
      summary: options.summary,
      entries: options.entries
    }, options.dryRun, changed);
  }

  const commands = [];
  if (!options.dryRun) {
    run("npm", ["run", "docs:sync-version"]);
    commands.push("npm run docs:sync-version");
    if (options.fixtures) {
      run("npm", ["run", "verify:protocol:gates"], {
        env: {
          PACTIUM_UPDATE_FIXTURES: "1"
        }
      });
      commands.push("PACTIUM_UPDATE_FIXTURES=1 npm run verify:protocol:gates");
    }
    if (options.verify) {
      run("npm", ["run", "verify:release"]);
      commands.push("npm run verify:release");
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checked: "pactium-release-prepare",
    mode: options.dryRun ? "dry-run" : "write",
    from: currentVersion,
    to: options.version,
    changedFiles: [...changed].sort(),
    commands
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
