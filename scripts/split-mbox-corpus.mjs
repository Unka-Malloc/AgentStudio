#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_CORPUS_DIR = "~/.pact-server-data/evaluation-corpora/mail/messages";
const DEFAULT_REPORT_PATH = "~/.pact-server-data/evaluation-corpora/mail/reports/split-mbox-report.json";

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    corpusDir: DEFAULT_CORPUS_DIR,
    reportPath: DEFAULT_REPORT_PATH,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[index + 1] || options.root;
      index += 1;
    } else if (arg === "--corpus") {
      options.corpusDir = argv[index + 1] || options.corpusDir;
      index += 1;
    } else if (arg === "--report") {
      options.reportPath = argv[index + 1] || options.reportPath;
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  options.root = resolveInputPath(options.root, process.cwd());
  options.corpusDir = resolveInputPath(options.corpusDir, options.root);
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

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMboxSeparator(line) {
  if (!line || line.length < 12) {
    return false;
  }
  if (
    line[0] !== 0x46 ||
    line[1] !== 0x72 ||
    line[2] !== 0x6f ||
    line[3] !== 0x6d ||
    line[4] !== 0x20
  ) {
    return false;
  }

  const header = line.subarray(0, Math.min(line.length, 180)).toString("latin1").trimEnd();
  return /^From \S+ (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(header) || /^From - /.test(header);
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function writeUniqueMessage({ message, corpusDir, dryRun }) {
  if (!message || message.length === 0) {
    return { empty: true };
  }

  const hash = hashBuffer(message);
  const targetPath = path.join(corpusDir, `${hash}.eml`);
  const exists = await pathExists(targetPath);
  if (!exists && !dryRun) {
    await fsp.writeFile(targetPath, message);
  }

  return {
    empty: false,
    hash,
    targetPath,
    created: !exists,
    duplicate: exists,
    byteSize: message.length
  };
}

async function splitMboxFile({ mboxPath, corpusDir, dryRun }) {
  const stats = await fsp.stat(mboxPath);
  const stream = fs.createReadStream(mboxPath);
  let pending = Buffer.alloc(0);
  let current = [];
  let messageCount = 0;
  let createdCount = 0;
  let duplicateCount = 0;
  let emptyCount = 0;
  let createdBytes = 0;
  let duplicateBytes = 0;

  async function flushMessage() {
    if (current.length === 0) {
      return;
    }
    const message = Buffer.concat(current);
    current = [];
    const result = await writeUniqueMessage({ message, corpusDir, dryRun });
    if (result.empty) {
      emptyCount += 1;
      return;
    }
    messageCount += 1;
    if (result.created) {
      createdCount += 1;
      createdBytes += result.byteSize;
    } else {
      duplicateCount += 1;
      duplicateBytes += result.byteSize;
    }
  }

  for await (const chunk of stream) {
    let buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const newlineIndex = buffer.indexOf(0x0a, start);
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.subarray(start, newlineIndex + 1);
      if (isMboxSeparator(line)) {
        await flushMessage();
      } else {
        current.push(line);
      }
      start = newlineIndex + 1;
    }
    pending = buffer.subarray(start);
  }

  if (pending.length > 0) {
    if (isMboxSeparator(pending)) {
      await flushMessage();
    } else {
      current.push(pending);
    }
  }
  await flushMessage();

  if (!dryRun) {
    await fsp.rm(mboxPath, { force: true });
  }

  return {
    path: path.relative(process.cwd(), mboxPath),
    byteSize: stats.size,
    messageCount,
    createdCount,
    duplicateCount,
    emptyCount,
    createdBytes,
    duplicateBytes,
    deleted: !dryRun
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fsp.mkdir(options.corpusDir, { recursive: true });
  const entries = await fsp.readdir(options.corpusDir, { withFileTypes: true });
  const mboxPaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mbox"))
    .map((entry) => path.join(options.corpusDir, entry.name))
    .sort();

  const files = [];
  for (const mboxPath of mboxPaths) {
    const result = await splitMboxFile({
      mboxPath,
      corpusDir: options.corpusDir,
      dryRun: options.dryRun
    });
    files.push(result);
    console.error(
      `split ${path.basename(mboxPath)} messages=${result.messageCount} created=${result.createdCount} duplicates=${result.duplicateCount}`
    );
  }

  const summary = files.reduce(
    (acc, file) => ({
      mboxCount: acc.mboxCount + 1,
      mboxBytes: acc.mboxBytes + file.byteSize,
      messageCount: acc.messageCount + file.messageCount,
      createdCount: acc.createdCount + file.createdCount,
      duplicateCount: acc.duplicateCount + file.duplicateCount,
      emptyCount: acc.emptyCount + file.emptyCount,
      createdBytes: acc.createdBytes + file.createdBytes,
      duplicateBytes: acc.duplicateBytes + file.duplicateBytes
    }),
    {
      mboxCount: 0,
      mboxBytes: 0,
      messageCount: 0,
      createdCount: 0,
      duplicateCount: 0,
      emptyCount: 0,
      createdBytes: 0,
      duplicateBytes: 0
    }
  );
  const report = {
    ok: true,
    dryRun: options.dryRun,
    corpusDir: options.corpusDir,
    ...summary,
    files
  };

  await fsp.mkdir(path.dirname(options.reportPath), { recursive: true });
  await fsp.writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    dryRun: options.dryRun,
    ...summary,
    reportPath: options.reportPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
