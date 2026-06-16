#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serviceEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/server.mjs");
const serviceSource = await fs.readFile(serviceEntry, "utf8");

assert.match(serviceSource, /ARCHIVE_TOTAL_UNCOMPRESSED_MAX_BYTES/, "archive parser must define a total decompressed byte limit");
assert.match(serviceSource, /function preflightZipFile/, "mounted ZIP extraction must preflight entries before extraction");
assert.match(serviceSource, /function preflightTarFile/, "mounted TAR extraction must preflight entries before extraction");
assert.match(serviceSource, /function preflightSevenZipFile/, "mounted 7z extraction must preflight entries before extraction");
assert.match(serviceSource, /validateExtractedDirectoryQuotas/, "external extraction output must be rechecked before consumption");
assert.match(serviceSource, /inflateRawSync\(compressed,\s*\{[\s\S]*maxOutputLength/, "inline ZIP inflation must be bounded");
assert.match(serviceSource, /gunzipSync\(Buffer\.from\(buffer \|\| \[\]\),\s*\{ maxOutputLength:/, "inline GZip inflation must be bounded");
assert.match(serviceSource, /gunzipFileToPath\(\{[\s\S]*maxBytes: ARCHIVE_TOTAL_UNCOMPRESSED_MAX_BYTES/, "mounted TGZ inflation must be bounded before TAR extraction");

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function parsePrompt(question = "") {
  try {
    return question ? JSON.parse(question) : {};
  } catch {
    return {};
  }
}

function modelInputFromPrompt(prompt = {}) {
  return prompt.originalInput && typeof prompt.originalInput === "object"
    ? prompt.originalInput
    : prompt;
}

function modelPayload(body = {}) {
  const prompt = modelInputFromPrompt(parsePrompt(body.question || ""));
  const documents = Array.isArray(prompt.documents) ? prompt.documents : [];
  const groups = Array.isArray(prompt.groups) ? prompt.groups : [];
  const sourceIds = Array.isArray(body.sourceIds) && body.sourceIds.length
    ? body.sourceIds
    : documents.map((document) => document.sourceId).filter(Boolean);
  const evidenceRefs = documents.map((document) => document.evidenceRef).filter(Boolean);
  if (body.distillationScope === "classification-group") {
    return {
      protocolVersion: "v0.0.1:external-service:knowledge-distillation-model-output-1",
      distillationScope: "classification-group",
      groupId: body.groupId || prompt.group?.groupId || "",
      label: body.groupLabel || prompt.group?.label || "archive-security",
      sourceIds,
      evidenceRefs,
      summary: "Archive security classification group output.",
      findings: [{
        claim: "Archive security verification preserves bounded group evidence.",
        sourceIds,
        evidenceRefs,
        confidence: 0.9
      }],
      risks: []
    };
  }
  return {
    protocolVersion: "v0.0.1:external-service:knowledge-distillation-model-output-1",
    distillationScope: "project-convergence",
    summary: "Archive security verification model output.",
    groups: groups.map((group) => {
      const groupSourceIds = Array.isArray(group.sourceIds) ? group.sourceIds : [];
      const groupEvidenceRefs = documents
        .filter((document) => groupSourceIds.includes(document.sourceId))
        .map((document) => document.evidenceRef)
        .filter(Boolean);
      return {
        groupId: group.groupId,
        label: group.label || group.groupId,
        sourceIds: groupSourceIds,
        evidenceRefs: groupEvidenceRefs,
        summary: "Archive security group output.",
        findings: [{
          claim: "Archive security verification preserves group source references.",
          sourceIds: groupSourceIds,
          evidenceRefs: groupEvidenceRefs,
          confidence: 0.9
        }]
      };
    }),
    timeline: documents.slice(0, 4).map((document) => ({
      time: document.documentTime || "",
      sourceIds: [document.sourceId].filter(Boolean),
      evidenceRefs: [document.evidenceRef].filter(Boolean),
      summary: "Archive security timeline output."
    })),
    findings: [{
      claim: "Archive security verification preserves source references.",
      sourceIds,
      evidenceRefs,
      confidence: 0.9
    }],
    risks: []
  };
}

async function startMockModelGateway() {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        body = {};
      }
      const payload = modelPayload(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        text: JSON.stringify(payload),
        structuredOutput: payload
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/api/agent-gateway/call`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function startService({ port, dataDir, inputDir, modelGatewayUrl }) {
  const child = spawn(process.execPath, [serviceEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SERVICE_DATA_DIR: dataDir,
      PACT_EXTERNAL_KD_INPUT_ROOTS: inputDir,
      PACT_EXTERNAL_KD_ALLOW_UNAUTHENTICATED_DEV: "1",
      PACT_EXTERNAL_KD_REQUIRE_API_TOKEN: "0",
      PACT_EXTERNAL_KD_MODEL_GATEWAY_URL: modelGatewayUrl,
      PACT_EXTERNAL_KD_MODEL_ALIAS: "archive-security-model",
      PACT_EXTERNAL_KD_ARCHIVE_ENTRY_MAX_BYTES: "1024",
      PACT_EXTERNAL_KD_ARCHIVE_TOTAL_UNCOMPRESSED_MAX_BYTES: "2048",
      PACT_EXTERNAL_KD_STRUCTURED_ZIP_ENTRY_MAX_BYTES: "1024",
      PACT_EXTERNAL_KD_STRUCTURED_ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES: "2048"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderrText = "";
  child.stderr.on("data", (chunk) => {
    child.stderrText += chunk.toString("utf8");
  });
  return child;
}

async function waitForService(baseUrl, child) {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "external KD service exited before health check completed");
    try {
      const health = await fetchJson(`${baseUrl}/health`);
      if (health.status === 200 && health.payload.ok === true) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`external KD service did not become healthy: ${lastError?.message || "timeout"}`);
}

async function stopService(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 1500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function zipBuffer(entries = {}) {
  const zipped = {};
  for (const [name, value] of Object.entries(entries)) {
    zipped[name] = strToU8(String(value));
  }
  return Buffer.from(zipSync(zipped, { level: 9 }));
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kd-archive-security-"));
const modelGateway = await startMockModelGateway();
const port = await freePort();
const dataDir = path.join(tempRoot, "data");
const inputDir = path.join(tempRoot, "inputs");
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(inputDir, { recursive: true });
const traversalZipPath = path.join(inputDir, "traversal.zip");
const quotaZipPath = path.join(inputDir, "quota.zip");
const inlineQuotaZip = zipBuffer({ "inline-big.txt": "A".repeat(4096) });
await fs.writeFile(traversalZipPath, zipBuffer({ "../escape.txt": "escape", "safe.txt": "safe" }));
await fs.writeFile(quotaZipPath, zipBuffer({ "quota-big.txt": "B".repeat(4096) }));

const child = startService({ port, dataDir, inputDir, modelGatewayUrl: modelGateway.url });
const serviceUrl = `http://127.0.0.1:${port}`;
try {
  await waitForService(serviceUrl, child);

  const capabilities = await fetchJson(`${serviceUrl}/v1/capabilities`);
  assert.equal(capabilities.status, 200);
  assert.ok(capabilities.payload.parserExecution.allowedInputRoots.includes(inputDir));
  assert.equal(
    capabilities.payload.parserExecution.allowedInputRoots.includes(dataDir),
    false,
    "service DATA_DIR must not be accepted as a file-ref root by default"
  );

  const run = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "archive-security-verifier",
      rawDocuments: [
        {
          sourceId: "safe-text",
          fileName: "safe.md",
          text: "# Safe text\nArchive verifier keeps one valid document for model execution."
        },
        {
          sourceId: "traversal-archive",
          fileName: "traversal.zip",
          mediaType: "application/zip",
          filePath: traversalZipPath
        },
        {
          sourceId: "quota-archive",
          fileName: "quota.zip",
          mediaType: "application/zip",
          filePath: quotaZipPath
        },
        {
          sourceId: "inline-quota-archive",
          fileName: "inline-quota.zip",
          mediaType: "application/zip",
          contentBase64: inlineQuotaZip.toString("base64")
        }
      ]
    })
  });
  assert.equal(run.status, 201, `distillation run should succeed; payload=${JSON.stringify(run.payload)} stderr=${child.stderrText}`);
  const documents = run.payload.result?.corpusPlan?.documents || [];
  const traversalParent = documents.find((document) => document.sourceId === "traversal-archive");
  const quotaParent = documents.find((document) => document.sourceId === "quota-archive");
  assert.ok(traversalParent, "traversal archive parent should remain visible for diagnostics");
  assert.ok(quotaParent, "quota archive parent should remain visible for diagnostics");
  assert.equal(documents.some((document) => document.sourceId === "traversal-archive!escape.txt"), false);
  assert.equal(documents.some((document) => document.sourceId === "quota-archive!quota-big.txt"), false);
  assert.equal(documents.some((document) => document.sourceId === "inline-quota-archive!inline-big.txt"), false);
  assert.match(JSON.stringify(traversalParent.parserTrace), /unsafe archive member path|ARCHIVE_UNSAFE_MEMBER_PATH|path-traversal/);
  assert.match(JSON.stringify(quotaParent.parserTrace), /byte limit|ARCHIVE_ENTRY_QUOTA_EXCEEDED|entry-too-large/);
} finally {
  await stopService(child);
  await modelGateway.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("external knowledge distillation archive security verification passed");
