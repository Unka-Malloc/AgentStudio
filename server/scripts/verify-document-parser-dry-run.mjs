import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${rawText}`);
  }
  return rawText.trim() ? JSON.parse(rawText) : {};
}

async function fetchJsonResponse(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertMarkdownUploadRouting(result, label) {
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const routedSource = sources.find((source) => source.name === "dry-run.md");
  assert.ok(routedSource, `${label} should preserve the declared .md upload name`);
  assert.equal(routedSource.kind, "text", `${label} should route declared markdown as text`);
  assert.notEqual(
    routedSource.mediaType,
    "message/rfc822",
    `${label} should not pass declared markdown to Tika as RFC822 email`
  );
  assert.equal(
    sources.some((source) => source.kind === "email" || source.name === "dry-run.eml"),
    false,
    `${label} should not let weak text sniffing convert markdown into email`
  );
  assert.equal(routedSource.documentParserId, "builtin/text-direct", `${label} should bypass Tika for markdown text`);
  assert.match(routedSource.text || "", /^# Dry-run parsing/, `${label} should preserve markdown source text`);
  assert.doesNotMatch(routedSource.text || "", /<html|X-TIKA/i, `${label} should not wrap markdown in Tika XHTML`);
}

function documentParsingConfig({
  pipelineId = "dynamic-parameter-v1",
  expectedOutput = "chunks",
  expectedOutputs = ["chunks", "preprocessResult"]
} = {}) {
  return {
    pipelineId,
    expectedOutput,
    expectedOutputs,
    chunking: {
      maxTokens: 120,
      maxChars: 800,
      overlapTokens: 0,
      sectionLevel: 2
    },
    granularity: {
      preferOriginalStructure: true,
      allowPartialEvidence: true,
      targetTokens: 120,
      targetChars: 800,
      secondaryParse: {
        enabled: false
      }
    },
    dynamicParsing: {
      enabled: true,
      preserveStructureArtifacts: true
    }
  };
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-document-parser-dry-run-"));
const pactServer = await startHttpServer({
  userDataPath,
  host: "127.0.0.1",
  port: 0
});

try {
  await installAuthenticatedFetch(pactServer);

  const beforeJobs = await fetchJson(`${pactServer.url}/api/jobs?limit=20`);
  const fileBuffer = Buffer.from(
    [
      "# Dry-run parsing",
      "",
      "Date: 2026-05-30",
      "",
      "| key | value |",
      "| --- | --- |",
      "| alpha | beta |",
      "",
      "This document must be parsed by the backend document parser dry-run path."
    ].join("\n"),
    "utf8"
  );
  const fileDigest = {
    name: "dry-run.md",
    relativePath: "dry-run.md",
    mediaType: "text/markdown",
    byteSize: fileBuffer.length,
    sha256: sha256(fileBuffer)
  };
  const directParsed = await fetchJson(`${pactServer.url}/api/knowledge/document-parser/parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: "",
      filePaths: [],
      uploadedFiles: [
        {
          ...fileDigest,
          originalFileName: fileDigest.name,
          dataBase64: fileBuffer.toString("base64")
        }
      ],
      dryRun: true,
      documentParsing: documentParsingConfig()
    })
  });
  assert.equal(directParsed.pipelineId, "dynamic-parameter-v1");
  assert.ok(directParsed.summary.sources >= 1, "direct dry-run parser should read uploaded file payloads");
  assert.ok(
    directParsed.sources.some((source) => String(source.name || source.path || "").includes("dry-run.md")),
    "direct dry-run parser should expose the uploaded file as a parsed source"
  );
  assertMarkdownUploadRouting(directParsed, "direct dry-run parser");
  assert.ok(directParsed.summary.chunks >= 1, "direct dry-run parser should return chunks");

  const manifestDigest = sha256(JSON.stringify([[fileDigest.relativePath, fileDigest.sha256, fileDigest.byteSize]]));
  const inputDigest = sha256("");
  const uploadSession = await fetchJson(`${pactServer.url}/api/upload-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      manifest: {
        manifestDigest,
        inputDigest,
        fileCount: 1,
        totalBytes: fileBuffer.length,
        fileRecords: [
          {
            label: fileDigest.name,
            relativePath: fileDigest.relativePath,
            sha256: fileDigest.sha256,
            byteSize: fileDigest.byteSize
          }
        ]
      },
      files: [fileDigest],
      checkpoint: {
        checkpointId: `document-parser-dry-run:${manifestDigest}`,
        parentCheckpointId: "",
        mode: "server-console-preview",
        source: "knowledge-console-preview",
        inputDigest,
        manifestDigest
      }
    })
  });

  await fetchJson(
    `${pactServer.url}/api/upload-sessions/${encodeURIComponent(
      uploadSession.sessionId
    )}/files/0?offset=0`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream"
      },
      body: fileBuffer
    }
  );

  const parsed = await fetchJson(`${pactServer.url}/api/knowledge/document-parser/parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uploadSessionId: uploadSession.sessionId,
      inputText: "",
      filePaths: [],
      uploadedFiles: [],
      dryRun: true,
      cleanupUploadSession: true,
      documentParsing: documentParsingConfig({
        pipelineId: "unified-knowledge-ingest-v1",
        expectedOutput: "preprocessResult",
        expectedOutputs: ["preprocessResult", "chunks"]
      })
    })
  });
  const uploadSessionAfterParse = await fetchJsonResponse(
    `${pactServer.url}/api/upload-sessions/${encodeURIComponent(uploadSession.sessionId)}`
  );
  const afterJobs = await fetchJson(`${pactServer.url}/api/jobs?limit=20`);

  assert.equal(parsed.pipelineId, "unified-knowledge-ingest-v1");
  assert.ok(parsed.summary.sources >= 1, "dry-run parser should read upload-session sources");
  assert.ok(
    parsed.sources.some((source) => String(source.name || source.path || "").includes("dry-run.md")),
    "dry-run parser should expose the uploaded file as a parsed source"
  );
  assertMarkdownUploadRouting(parsed, "upload-session dry-run parser");
  assert.ok(parsed.summary.chunks >= 1, "dry-run parser should return chunks");
  assert.ok(parsed.preprocessResult, "unified knowledge ingest parser should return a preprocess result");
  assert.ok(
    parsed.summary.structureArtifacts >= 1,
    "unified knowledge ingest parser should return structure artifacts"
  );
  assert.equal(uploadSessionAfterParse.status, 404, "preview upload sessions must be cleaned after dry-run parse");
  assert.equal(
    afterJobs.summary.totalCount,
    beforeJobs.summary.totalCount,
    "document parser dry-run must not create a persisted job"
  );

  console.log("Document parser dry-run verification passed.");
  console.log(`Server URL: ${pactServer.url}`);
} finally {
  await pactServer.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
