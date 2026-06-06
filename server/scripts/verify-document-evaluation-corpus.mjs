#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));
}

function assertBaseManifestShape(manifest, label) {
  assert.equal(manifest.schemaVersion, 1, `${label} must declare schemaVersion=1`);
  assert.equal(typeof manifest.corpusId, "string");
  assert.ok(manifest.corpusId.length > 0, `${label} corpusId must be non-empty`);
  assert.equal(typeof manifest.storageRoot, "string");
  assert.ok(manifest.storageRoot.length > 0, `${label} storageRoot must be non-empty`);
  assert.ok(Array.isArray(manifest.items), `${label} must include items[]`);
  assert.ok(manifest.items.length > 0, `${label} must include at least one item`);
}

function assertMailTemplatePrivacyBoundary(mailManifest) {
  const boundary = mailManifest.privacyBoundary;
  assert.equal(Boolean(boundary), true, "mail template must include privacyBoundary");
  assert.equal(boundary.rawContentInRepo, false, "mail template must forbid raw mail content in repository");
  assert.ok(
    String(boundary.reviewPathPolicy || "").includes("~/.pact-server-data/evaluation-corpora/mail/"),
    "mail template review path policy must point to external mail data root",
  );

  const allowedMetadata = new Set(boundary.allowedRepositoryMetadata || []);
  for (const key of ["sha256", "byteSize", "messageCount", "threadCount", "attachmentCount", "format", "errorCodes"]) {
    assert.equal(allowedMetadata.has(key), true, `mail template privacyBoundary missing allowed metadata key: ${key}`);
  }
}

function assertMailTemplateItems(mailManifest) {
  assert.ok(
    String(mailManifest.storageRoot || "").startsWith("~/.pact-server-data/evaluation-corpora/mail/"),
    "mail template storageRoot must stay under external pact server data path",
  );
  for (const item of mailManifest.items) {
    assert.ok([".eml", ".mbox"].some((suffix) => String(item.relativePath || "").toLowerCase().endsWith(suffix)));
    assert.equal(Number.isInteger(item.messageCount), true, "mail template item.messageCount must be integer");
    assert.equal(Number.isInteger(item.threadCount), true, "mail template item.threadCount must be integer");
    assert.equal(Number.isInteger(item.attachmentCount), true, "mail template item.attachmentCount must be integer");
    assert.ok(Array.isArray(item.errorCodes), "mail template item.errorCodes must be an array");
    assert.ok(
      (item.expectedChecks || []).includes("thread-stats-recorded") &&
      (item.expectedChecks || []).includes("attachment-stats-recorded"),
      "mail template expectedChecks must require thread/attachment stats",
    );
  }
}

function runNode(commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, commandArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function parseEmailStats(rawText) {
  const messageIdMatch = /^message-id:\s*(.+)$/im.exec(rawText);
  const replyMatch = /^in-reply-to:\s*(.+)$/im.exec(rawText);
  const attachmentMatches = rawText.match(/^content-disposition:\s*attachment/igm) || [];
  return {
    messageId: (messageIdMatch?.[1] || "").trim().replace(/[<>]/g, "").toLowerCase(),
    inReplyTo: (replyMatch?.[1] || "").trim().replace(/[<>]/g, "").toLowerCase(),
    attachmentCount: attachmentMatches.length
  };
}

async function assertMailStatsPipeline(mailManifest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-mail-corpus-verify-"));
  const inputDir = path.join(root, "input-mail");
  const outDir = path.join(root, "corpus-mail");
  const reportPath = path.join(root, "report.json");
  await fs.mkdir(inputDir, { recursive: true });

  const mailA = [
    "From: Alice <alice@example.test>",
    "To: Bob <bob@example.test>",
    "Subject: Renewal kickoff",
    "Message-ID: <thread-1-a@example.test>",
    "Date: Tue, 04 Jun 2026 09:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Thread kickoff."
  ].join("\n");
  const mailB = [
    "From: Bob <bob@example.test>",
    "To: Alice <alice@example.test>",
    "Subject: Re: Renewal kickoff",
    "Message-ID: <thread-1-b@example.test>",
    "In-Reply-To: <thread-1-a@example.test>",
    "Date: Tue, 04 Jun 2026 09:10:00 +0000",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=boundary1",
    "",
    "--boundary1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Attached notes.",
    "--boundary1",
    "Content-Type: text/plain",
    "Content-Disposition: attachment; filename=notes.txt",
    "",
    "note",
    "--boundary1--"
  ].join("\n");

  await fs.writeFile(path.join(inputDir, "a.eml"), mailA, "utf8");
  await fs.writeFile(path.join(inputDir, "dup-a.eml"), mailA, "utf8");
  await fs.writeFile(path.join(inputDir, "b.eml"), mailB, "utf8");

  const runResult = await runNode([
    "scripts/collect-dedupe-emails.mjs",
    "--root", root,
    "--out", outDir,
    "--report", reportPath
  ], repoRoot);
  assert.equal(runResult.code, 0, `collect-dedupe-emails must pass: ${runResult.stderr || runResult.stdout}`);

  const dedupeReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(dedupeReport.ok, true);
  assert.equal(dedupeReport.scannedCount, 3);
  assert.equal(dedupeReport.uniqueCount, 2);
  assert.equal(dedupeReport.duplicateCount, 1);
  assert.ok(Array.isArray(dedupeReport.kept) && dedupeReport.kept.length === 2);

  const keptMailPaths = dedupeReport.kept.map((entry) => path.join(root, entry.corpusPath));
  const parsedMails = await Promise.all(
    keptMailPaths.map(async (filePath) => parseEmailStats(await fs.readFile(filePath, "utf8")))
  );

  const messageCount = parsedMails.length;
  const attachmentCount = parsedMails.reduce((sum, entry) => sum + entry.attachmentCount, 0);
  const messageIdSet = new Set(parsedMails.map((entry) => entry.messageId).filter(Boolean));
  const threadRoots = new Set(
    parsedMails.map((entry) => entry.inReplyTo && messageIdSet.has(entry.inReplyTo) ? entry.inReplyTo : entry.messageId)
      .filter(Boolean)
  );
  const threadCount = threadRoots.size;

  assert.equal(messageCount, 2, "dedupe stats should keep two unique message payloads");
  assert.equal(threadCount, 1, "synthetic fixture should collapse into one thread");
  assert.equal(attachmentCount, 1, "synthetic fixture should retain one attachment marker");

  const allowedMetadata = new Set(mailManifest.privacyBoundary.allowedRepositoryMetadata || []);
  for (const key of ["messageCount", "threadCount", "attachmentCount", "errorCodes"]) {
    assert.equal(
      allowedMetadata.has(key),
      true,
      `mail template privacy boundary must allow repository-side ${key} statistics`,
    );
  }
}

async function main() {
  const schema = await readJson("docs/examples/document-evaluation-corpus-manifest.schema.json");
  const publicSmoke = await readJson("docs/examples/document-evaluation-corpus-public-smoke.json");
  const mailTemplate = await readJson("docs/examples/document-evaluation-corpus-mail-local.template.json");

  assert.equal(schema?.properties?.items?.type, "array", "manifest schema must include items array contract");
  assert.equal(schema?.$defs?.privacyBoundary?.type, "object", "manifest schema must define privacyBoundary contract");

  assertBaseManifestShape(publicSmoke, "public-smoke manifest");
  assertBaseManifestShape(mailTemplate, "mail-local template");
  assertMailTemplatePrivacyBoundary(mailTemplate);
  assertMailTemplateItems(mailTemplate);
  await assertMailStatsPipeline(mailTemplate);

  console.log("document evaluation corpus verification passed");
}

await main();