import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { strToU8, unzipSync, zipSync } from "fflate";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const serviceEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/server.mjs");

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
    ok: response.ok,
    headers: response.headers,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function assertExternalGatewayCall(payload = {}, {
  serviceUrl = "",
  method = "GET",
  path = "",
  statusCode = 200,
  minRequestBytes = 0,
  minResponseBytes = 1
} = {}) {
  const call = payload.pactExternalServiceCall;
  assert.ok(call, "platform gateway responses must include external service call telemetry");
  assert.equal(call.protocolVersion, "pact.external-knowledge-distillation.v1.gateway-call-telemetry");
  assert.equal(call.service, "external.knowledge.distillation");
  assert.equal(call.baseUrl, serviceUrl);
  assert.equal(call.method, method);
  assert.equal(call.path, path);
  assert.equal(call.statusCode, statusCode);
  assert.equal(call.requestBytes >= minRequestBytes, true);
  assert.equal(call.responseBytes >= minResponseBytes, true);
  assert.equal(call.transferBytes >= call.requestBytes + call.responseBytes, true);
  assert.equal(call.durationMs >= 0, true);
  assert.equal(call.bytesPerSecond >= 0, true);
  assert.match(call.observedAt, /^\d{4}-\d{2}-\d{2}T/);
}

async function waitForService(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(`${url}/health`);
      if (health.status === 200 && health.payload.ok === true) {
        return health.payload;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`External distillation service did not become healthy: ${lastError?.message || "timeout"}`);
}

function startExternalService({ port, dataDir }) {
  const child = spawn(process.execPath, [serviceEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SERVICE_DATA_DIR: dataDir,
      PACT_EXTERNAL_KD_STRUCTURED_ZIP_ENTRY_MAX_BYTES: "25000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  return {
    child,
    async close() {
      if (child.exitCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
    stderr: () => stderr
  };
}

const requiredOperationIds = [
  "external.knowledge.distillation.service.health",
  "external.knowledge.distillation.service.capabilities",
  "external.knowledge.distillation.service.runtime_health",
  "external.knowledge.distillation.runs.list",
  "external.knowledge.distillation.runs.create",
  "external.knowledge.distillation.runs.get",
  "external.knowledge.distillation.runs.cancel",
  "external.knowledge.distillation.evidence.query",
  "external.knowledge.distillation.projects.evidence.query",
  "external.knowledge.distillation.artifacts.export"
];

const operationIds = new Set(SERVER_API_OPERATIONS.map((operation) => operation.id));
for (const operationId of requiredOperationIds) {
  assert.equal(operationIds.has(operationId), true, `${operationId} must be registered`);
}
const createRunOperation = SERVER_API_OPERATIONS.find((operation) => operation.id === "external.knowledge.distillation.runs.create");
assert.ok(createRunOperation, "external distillation create operation must exist");
assert.deepEqual(
  createRunOperation.inputSchema?.properties?.workflowScope?.enum,
  ["document", "corpus", "project"],
  "create run operation must expose workflowScope as an enum value parameter"
);
assert.equal(
  createRunOperation.inputSchema?.required?.includes("workflowScope"),
  true,
  "platform create run operation must force upstream callers to choose workflowScope explicitly"
);
assert.equal(createRunOperation.inputSchema?.properties?.workflowScope?.default, "project");

const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
const toolIds = new Set(catalog.tools.map((tool) => tool.id));
for (const toolId of [
  "pact.external.knowledge.distillation.health",
  "pact.external.knowledge.distillation.capabilities",
  "pact.external.knowledge.distillation.runtimeHealth",
  "pact.external.knowledge.distillation.runs.list",
  "pact.external.knowledge.distillation.runs.create",
  "pact.external.knowledge.distillation.runs.get",
  "pact.external.knowledge.distillation.runs.cancel",
  "pact.external.knowledge.distillation.evidence.query",
  "pact.external.knowledge.distillation.projects.evidence.query",
  "pact.external.knowledge.distillation.artifacts.export"
]) {
  assert.equal(toolIds.has(toolId), true, `${toolId} must be exposed in Tool Management catalog`);
}

const largePdfText = Array.from({ length: 420 }, (_, index) => (
  `Section ${index + 1}: Large engineering manual pages describe deployment routing, parser fallback, OCR recovery, and evidence windows for long PDF projects. `
)).join("");

function base64Text(text) {
  return Buffer.from(String(text), "utf8").toString("base64");
}

function base64Zip(entries) {
  const zipped = zipSync(Object.fromEntries(
    Object.entries(entries).map(([name, text]) => [name, strToU8(String(text))])
  ));
  return Buffer.from(zipped).toString("base64");
}

function zipBuffer(entries) {
  return Buffer.from(zipSync(Object.fromEntries(
    Object.entries(entries).map(([name, text]) => [name, strToU8(String(text))])
  )));
}

function sampleOfficeChartXml(title = "Evidence Trend", series = "Evidence Count") {
  return [
    "<c:chartSpace xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
    "<c:chart>",
    `<c:title><c:tx><c:rich><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title>`,
    "<c:plotArea><c:barChart><c:ser>",
    `<c:tx><c:v>${series}</c:v></c:tx>`,
    "<c:cat><c:strLit><c:pt idx=\"0\"><c:v>Q1</c:v></c:pt><c:pt idx=\"1\"><c:v>Q2</c:v></c:pt></c:strLit></c:cat>",
    "<c:val><c:numLit><c:pt idx=\"0\"><c:v>42</c:v></c:pt><c:pt idx=\"1\"><c:v>84</c:v></c:pt></c:numLit></c:val>",
    "</c:ser></c:barChart></c:plotArea>",
    "</c:chart>",
    "</c:chartSpace>"
  ].join("");
}

function tarOctal(value, length) {
  return String(Math.max(0, Number(value) || 0).toString(8)).padStart(length - 1, "0").slice(-(length - 1));
}

function writeTarField(header, offset, length, value) {
  header.write(String(value || "").slice(0, length), offset, length, "utf8");
}

function tarBuffer(entries = {}) {
  const chunks = [];
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(String(text), "utf8");
    const header = Buffer.alloc(512, 0);
    writeTarField(header, 0, 100, name);
    writeTarField(header, 100, 8, `${tarOctal(0o644, 7)}\0`);
    writeTarField(header, 108, 8, `${tarOctal(0, 7)}\0`);
    writeTarField(header, 116, 8, `${tarOctal(0, 7)}\0`);
    writeTarField(header, 124, 12, `${tarOctal(data.length, 11)}\0`);
    writeTarField(header, 136, 12, `${tarOctal(Math.floor(Date.now() / 1000), 11)}\0`);
    header.fill(0x20, 148, 156);
    writeTarField(header, 156, 1, "0");
    writeTarField(header, 257, 6, "ustar\0");
    writeTarField(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarField(header, 148, 8, `${tarOctal(checksum, 6)}\0 `);
    chunks.push(header, data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) {
      chunks.push(Buffer.alloc(padding, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function base64Tar(entries = {}) {
  return tarBuffer(entries).toString("base64");
}

function base64Tgz(entries = {}) {
  return gzipSync(tarBuffer(entries)).toString("base64");
}

function multipartEmailBase64({ boundary = "pact-boundary", attachmentName = "invoice.csv", attachmentMediaType = "text/csv", attachmentText = "" } = {}) {
  const attachmentBase64 = Buffer.from(String(attachmentText || ""), "utf8").toString("base64");
  return base64Text([
    "From: analyst@example.test",
    "To: pact@example.test",
    "Subject: Attachment distillation evidence",
    "Date: Sun, 31 May 2026 10:00:00 +0000",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please review the attached invoice evidence for project distillation.",
    `--${boundary}`,
    `Content-Type: ${attachmentMediaType}; name="${attachmentName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    "",
    attachmentBase64,
    `--${boundary}--`,
    ""
  ].join("\r\n"));
}

function mboxBase64() {
  const attachmentBase64 = Buffer.from("vendor,total\nMboxCo,144", "utf8").toString("base64");
  return base64Text([
    "From analyst@example.test Sun May 31 10:00:00 2026",
    "From: analyst@example.test",
    "To: pact@example.test",
    "Subject: MBOX Architecture Evidence",
    "Date: Sun, 31 May 2026 10:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "MBOX first message records architecture parser routing evidence.",
    "From finance@example.test Sun May 31 10:05:00 2026",
    "From: finance@example.test",
    "To: pact@example.test",
    "Subject: MBOX Invoice Attachment",
    "Date: Sun, 31 May 2026 10:05:00 +0000",
    "Content-Type: multipart/mixed; boundary=\"mbox-boundary\"",
    "",
    "--mbox-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "MBOX second message contains invoice attachment evidence.",
    "--mbox-boundary",
    "Content-Type: text/csv; name=\"mbox-invoice.csv\"",
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: attachment; filename=\"mbox-invoice.csv\"",
    "",
    attachmentBase64,
    "--mbox-boundary--",
    ""
  ].join("\r\n"));
}

function msgTextBase64(text = "Outlook MSG Tika fallback extracts project schedule evidence.") {
  return base64Text(text);
}

const sampleDocxBase64 = base64Zip({
  "word/document.xml": [
    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\">",
    "<w:body>",
    "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>DOCX Contract Decision Register</w:t></w:r></w:p>",
    "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Routing Decisions</w:t></w:r></w:p>",
    "<w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"9\"/></w:numPr></w:pPr><w:r><w:t>Preserve Word list hierarchy for agent filters.</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>Standalone DOCX payload parser extracts contract decisions.</w:t></w:r></w:p>",
    "<w:sdt><w:sdtPr><w:id w:val=\"100\"/><w:alias w:val=\"Decision Owner\"/><w:tag w:val=\"decision.owner\"/><w:text/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Decision owner is Platform Architecture.</w:t></w:r></w:p></w:sdtContent></w:sdt>",
    "<w:p><w:bookmarkStart w:id=\"42\" w:name=\"DecisionScope\"/><w:r><w:t>Bookmark scope captures routing impact.</w:t></w:r><w:bookmarkEnd w:id=\"42\"/></w:p>",
    "<w:p><w:r><w:t>Evidence portal: </w:t></w:r><w:hyperlink r:id=\"rId1\"><w:r><w:t>DOCX evidence portal</w:t></w:r></w:hyperlink></w:p>",
    "<w:p><w:r><w:drawing><wp:inline><wp:docPr id=\"10\" name=\"Architecture Diagram\" descr=\"DOCX architecture diagram evidence\"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed=\"rIdImage1\"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
    "<w:p><w:r><w:drawing><wp:inline><wp:docPr id=\"11\" name=\"Decision Trend Chart\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><c:chart r:id=\"rIdChart1\"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
    "<w:p><w:r><w:t>Annotation reference paragraph.</w:t></w:r><w:r><w:footnoteReference w:id=\"2\"/></w:r></w:p>",
    "<w:p><w:ins w:id=\"10\" w:author=\"Revision Author\" w:date=\"2026-07-02T00:00:00Z\"><w:r><w:t>Inserted tracked-change evidence stays visible.</w:t></w:r></w:ins></w:p>",
    "<w:p><w:del w:id=\"11\" w:author=\"Revision Author\" w:date=\"2026-07-03T00:00:00Z\"><w:r><w:delText>Deleted tracked-change evidence stays visible.</w:delText></w:r></w:del></w:p>",
    "<w:tbl>",
    "<w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Decision</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Due Date</w:t></w:r></w:p></w:tc></w:tr>",
    "<w:tr><w:tc><w:p><w:r><w:t>Platform</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Adopt external.knowledge.distillation routing</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2026-07-10</w:t></w:r></w:p></w:tc></w:tr>",
    "</w:tbl>",
    "</w:body>",
    "</w:document>"
  ].join(""),
  "word/_rels/document.xml.rels": [
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/docx-evidence\" TargetMode=\"External\"/>",
    "<Relationship Id=\"rIdImage1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/architecture.png\"/>",
    "<Relationship Id=\"rIdChart1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart\" Target=\"charts/chart1.xml\"/>",
    "</Relationships>"
  ].join(""),
  "word/header1.xml": [
    "<w:hdr xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    "<w:p><w:r><w:t>Header keeps contract classification and routing evidence visible.</w:t></w:r></w:p>",
    "</w:hdr>"
  ].join(""),
  "word/footer1.xml": [
    "<w:ftr xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    "<w:p><w:r><w:t>Footer keeps approval timestamp 2026-07-04 queryable.</w:t></w:r></w:p>",
    "</w:ftr>"
  ].join(""),
  "word/comments.xml": [
    "<w:comments xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    "<w:comment w:id=\"7\" w:author=\"Reviewer\" w:date=\"2026-07-01T00:00:00Z\"><w:p><w:r><w:t>Reviewer asks to keep routing decision evidence explicit.</w:t></w:r></w:p></w:comment>",
    "</w:comments>"
  ].join(""),
  "word/footnotes.xml": [
    "<w:footnotes xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    "<w:footnote w:id=\"2\"><w:p><w:r><w:t>Footnote captures deployment prerequisite for the external service.</w:t></w:r></w:p></w:footnote>",
    "</w:footnotes>"
  ].join(""),
  "word/endnotes.xml": [
    "<w:endnotes xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    "<w:endnote w:id=\"3\"><w:p><w:r><w:t>Endnote keeps the audit trail available to agents.</w:t></w:r></w:p></w:endnote>",
    "</w:endnotes>"
  ].join(""),
  "word/charts/chart1.xml": sampleOfficeChartXml("DOCX Decision Trend", "DOCX Evidence Count"),
  "word/media/architecture.png": "docx-image-bytes"
});

const samplePptxBase64 = base64Zip({
  "ppt/slides/slide1.xml": [
    "<p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" ",
    "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
    "xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\">",
    "<p:cSld><p:spTree>",
    "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Roadmap Title\"/></p:nvSpPr><p:nvPr><p:ph type=\"title\" idx=\"0\"/></p:nvPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"457200\"/><a:ext cx=\"5486400\" cy=\"685800\"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Standalone PPTX slide parser extracts roadmap decisions.</a:t></a:r></a:p></p:txBody></p:sp>",
    "<p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Roadmap Body\"/></p:nvSpPr><p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"1371600\"/><a:ext cx=\"6400800\" cy=\"914400\"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Presentation geometry keeps slide shape evidence queryable. </a:t></a:r><a:r><a:rPr><a:hlinkClick r:id=\"rId1\" tooltip=\"Presentation evidence link\"/></a:rPr><a:t>Presentation evidence portal</a:t></a:r></a:p></p:txBody></p:sp>",
    "<p:pic><p:nvPicPr><p:cNvPr id=\"5\" name=\"Roadmap Diagram\" descr=\"PPTX roadmap diagram evidence\"/></p:nvPicPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"1828800\"/><a:ext cx=\"1828800\" cy=\"685800\"/></a:xfrm></p:spPr><p:blipFill><a:blip r:embed=\"rIdImage1\"/></p:blipFill></p:pic>",
    "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"4\" name=\"Roadmap Decision Table\"/></p:nvGraphicFramePr><p:xfrm><a:off x=\"914400\" y=\"2590800\"/><a:ext cx=\"6400800\" cy=\"914400\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl>",
    "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Owner</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Decision</a:t></a:r></a:p></a:txBody></a:tc></a:tr>",
    "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Slides</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Keep PowerPoint table cells queryable</a:t></a:r></a:p></a:txBody></a:tc></a:tr>",
    "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>",
    "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"6\" name=\"Roadmap Trend Chart\"/></p:nvGraphicFramePr><p:xfrm><a:off x=\"914400\" y=\"3657600\"/><a:ext cx=\"6400800\" cy=\"914400\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><c:chart r:id=\"rIdChart1\"/></a:graphicData></a:graphic></p:graphicFrame>",
    "</p:spTree></p:cSld>",
    "</p:sld>"
  ].join(""),
  "ppt/slides/_rels/slide1.xml.rels": [
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/pptx-evidence\" TargetMode=\"External\"/>",
    "<Relationship Id=\"rIdImage1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/roadmap.png\"/>",
    "<Relationship Id=\"rIdChart1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart\" Target=\"../charts/chart1.xml\"/>",
    "<Relationship Id=\"rIdComment1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments\" Target=\"../comments/comment1.xml\"/>",
    "<Relationship Id=\"rIdLayout1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>",
    "</Relationships>"
  ].join(""),
  "ppt/slideLayouts/slideLayout1.xml": [
    "<p:sldLayout xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" ",
    "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
    "type=\"titleAndContent\">",
    "<p:cSld name=\"Roadmap Layout\"><p:spTree>",
    "<p:sp><p:nvSpPr><p:cNvPr id=\"11\" name=\"Layout Title Placeholder\"/></p:nvSpPr><p:nvPr><p:ph type=\"title\" idx=\"0\"/></p:nvPr><p:txBody><a:p><a:r><a:t>Roadmap layout title placeholder</a:t></a:r></a:p></p:txBody></p:sp>",
    "<p:sp><p:nvSpPr><p:cNvPr id=\"12\" name=\"Layout Body Placeholder\"/></p:nvSpPr><p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr><p:txBody><a:p><a:r><a:t>Roadmap layout body placeholder</a:t></a:r></a:p></p:txBody></p:sp>",
    "</p:spTree></p:cSld>",
    "</p:sldLayout>"
  ].join(""),
  "ppt/slideLayouts/_rels/slideLayout1.xml.rels": [
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rIdMaster1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/>",
    "</Relationships>"
  ].join(""),
  "ppt/slideMasters/slideMaster1.xml": [
    "<p:sldMaster xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" ",
    "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
    "<p:cSld name=\"Knowledge Distillation Master\"><p:spTree>",
    "<p:sp><p:nvSpPr><p:cNvPr id=\"21\" name=\"Master Footer\"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Knowledge distillation master footer evidence</a:t></a:r></a:p></p:txBody></p:sp>",
    "</p:spTree></p:cSld>",
    "</p:sldMaster>"
  ].join(""),
  "ppt/commentAuthors.xml": [
    "<p:cmAuthorLst xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
    "<p:cmAuthor id=\"0\" name=\"Slide Reviewer\" initials=\"SR\" lastIdx=\"1\"/>",
    "</p:cmAuthorLst>"
  ].join(""),
  "ppt/comments/comment1.xml": [
    "<p:cmLst xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
    "<p:cm authorId=\"0\" dt=\"2026-06-01T10:00:00Z\" idx=\"1\"><p:pos x=\"914400\" y=\"914400\"/><p:text>Slide reviewer confirmed the roadmap decision.</p:text></p:cm>",
    "</p:cmLst>"
  ].join(""),
  "ppt/notesSlides/notesSlide1.xml": [
    "<p:notes xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" ",
    "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
    "<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speaker note keeps release risk and operator follow-up evidence queryable.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>",
    "</p:notes>"
  ].join(""),
  "ppt/charts/chart1.xml": sampleOfficeChartXml("PPTX Roadmap Trend", "Slide Evidence Count"),
  "ppt/media/roadmap.png": "pptx-image-bytes"
});

const sampleVisioBase64 = base64Zip({
  "[Content_Types].xml": [
    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
    "<Override PartName=\"/visio/document.xml\" ContentType=\"application/vnd.ms-visio.drawing.main+xml\"/>",
    "<Override PartName=\"/visio/pages/page1.xml\" ContentType=\"application/vnd.ms-visio.page+xml\"/>",
    "</Types>"
  ].join(""),
  "_rels/.rels": [
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rId1\" Type=\"http://schemas.microsoft.com/visio/2010/relationships/document\" Target=\"visio/document.xml\"/>",
    "</Relationships>"
  ].join(""),
  "visio/document.xml": [
    "<VisioDocument xmlns=\"http://schemas.microsoft.com/office/visio/2012/main\">",
    "<DocumentProperties><Title>External KD Flow</Title></DocumentProperties>",
    "<Pages><Page ID=\"0\" NameU=\"Main Flow\"/></Pages>",
    "</VisioDocument>"
  ].join(""),
  "visio/pages/page1.xml": [
    "<PageContents xmlns=\"http://schemas.microsoft.com/office/visio/2012/main\">",
    "<Shapes>",
    "<Shape ID=\"1\" NameU=\"Start\" Type=\"Shape\"><Text>External KD service</Text><Cell N=\"PinX\" V=\"1\"/><Cell N=\"PinY\" V=\"2\"/><Cell N=\"Width\" V=\"1.5\"/><Cell N=\"Height\" V=\"0.5\"/></Shape>",
    "<Shape ID=\"2\" NameU=\"Decision\" Type=\"Shape\"><Text>Route-first Visio parsing</Text><Cell N=\"PinX\" V=\"3\"/><Cell N=\"PinY\" V=\"2\"/><Cell N=\"Width\" V=\"1.75\"/><Cell N=\"Height\" V=\"0.75\"/></Shape>",
    "<Shape ID=\"3\" NameU=\"Connector\" Type=\"Shape\"><Text>evidence edge</Text></Shape>",
    "</Shapes>",
    "<Connects>",
    "<Connect FromSheet=\"3\" ToSheet=\"1\" FromPart=\"BeginX\" ToPart=\"PinX\"/>",
    "<Connect FromSheet=\"3\" ToSheet=\"2\" FromPart=\"EndX\" ToPart=\"PinX\"/>",
    "</Connects>",
    "</PageContents>"
  ].join("")
});

const sampleXlsxBase64 = base64Zip({
  "xl/sharedStrings.xml": [
    "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
    "<si><t>Vendor</t></si><si><t>Total</t></si><si><t>Payment Date</t></si><si><t>Projected Total</t></si>",
    "<si><t>Acme</t></si><si><t>42</t></si><si><t>2026-05-31</t></si>",
    "</sst>"
  ].join(""),
  "xl/styles.xml": [
    "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
    "<cellXfs count=\"2\"><xf numFmtId=\"0\"/><xf numFmtId=\"14\" applyNumberFormat=\"1\"/></cellXfs>",
    "</styleSheet>"
  ].join(""),
  "xl/workbook.xml": [
    "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
    "<sheets><sheet name=\"Finance Evidence\" sheetId=\"7\" r:id=\"rIdSheet1\"/></sheets>",
    "<definedNames><definedName name=\"DecisionRange\" localSheetId=\"0\">'Finance Evidence'!$A$1:$D$2</definedName><definedName name=\"_xlnm.Print_Area\" localSheetId=\"0\">'Finance Evidence'!$A$1:$D$2</definedName></definedNames>",
    "</workbook>"
  ].join(""),
  "xl/_rels/workbook.xml.rels": [
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rIdSheet1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>",
    "</Relationships>"
  ].join(""),
  "xl/worksheets/sheet1.xml": [
    "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
    "<sheetData><row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c><c t=\"s\"><v>2</v></c><c t=\"s\"><v>3</v></c></row><row><c t=\"s\"><v>4</v></c><c t=\"s\"><v>5</v></c><c r=\"C2\" s=\"1\"><v>46173</v></c><c r=\"D2\"><f>B2*2</f><v>84</v></c></row></sheetData>",
    "<mergeCells count=\"1\"><mergeCell ref=\"A1:B1\"/></mergeCells>",
    "<hyperlinks><hyperlink ref=\"A2\" r:id=\"rId1\" display=\"Acme portal\" tooltip=\"Vendor evidence link\"/></hyperlinks>",
    "<drawing r:id=\"rIdDrawing1\"/>",
    "</worksheet>"
  ].join(""),
  "xl/worksheets/_rels/sheet1.xml.rels": [
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/acme\" TargetMode=\"External\"/>",
    "<Relationship Id=\"rIdComment1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments\" Target=\"../comments1.xml\"/>",
    "<Relationship Id=\"rIdDrawing1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing1.xml\"/>",
    "</Relationships>"
  ].join(""),
  "xl/drawings/drawing1.xml": [
    "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
    "<xdr:twoCellAnchor><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id=\"7\" name=\"Finance Trend Chart\"/></xdr:nvGraphicFramePr><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><c:chart r:id=\"rIdChart1\"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>",
    "</xdr:wsDr>"
  ].join(""),
  "xl/drawings/_rels/drawing1.xml.rels": [
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rIdChart1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart\" Target=\"../charts/chart1.xml\"/>",
    "</Relationships>"
  ].join(""),
  "xl/charts/chart1.xml": sampleOfficeChartXml("XLSX Finance Trend", "Finance Evidence Count"),
  "xl/comments1.xml": [
    "<comments xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
    "<authors><author>Finance Reviewer</author></authors>",
    "<commentList><comment ref=\"B2\" authorId=\"0\"><text><r><t>Finance reviewer confirmed the total evidence.</t></r></text></comment></commentList>",
    "</comments>"
  ].join("")
});

const sampleOpenDocumentBase64 = base64Zip({
  "mimetype": "application/vnd.oasis.opendocument.text",
  "content.xml": [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" ",
    "xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" ",
    "xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\" ",
    "xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
    "<office:body><office:text>",
    "<text:h text:outline-level=\"1\">OpenDocument Distillation Plan</text:h>",
    "<text:p>OpenDocument parser preserves project convergence evidence as structured elements. <text:a xlink:href=\"https://example.com/odf-evidence\">OpenDocument evidence portal</text:a></text:p>",
    "<table:table table:name=\"ODF Decisions\">",
    "<table:table-row><table:table-cell><text:p>Owner</text:p></table:table-cell><table:table-cell><text:p>Decision</text:p></table:table-cell><table:table-cell><text:p>Due Date</text:p></table:table-cell></table:table-row>",
    "<table:table-row><table:table-cell><text:p>Platform</text:p></table:table-cell><table:table-cell><text:p>Keep OpenDocument cells queryable</text:p></table:table-cell><table:table-cell><text:p>2026-07-11</text:p></table:table-cell></table:table-row>",
    "</table:table>",
    "</office:text></office:body>",
    "</office:document-content>"
  ].join("")
});

const sampleEpubBase64 = base64Zip({
  "mimetype": "application/epub+zip",
  "META-INF/container.xml": "<?xml version=\"1.0\"?><container version=\"1.0\"></container>",
  "OEBPS/chapter1.xhtml": [
    "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>",
    "<h1>EPUB Distillation Evidence</h1>",
    "<p>EPUB chapter evidence remains available to agent element windows.</p>",
    "</body></html>"
  ].join("")
});

const sampleZipBase64 = base64Zip({
  "docs/architecture.md": "# Architecture\nExternal service route-first parsing.",
  "data/invoice.csv": "vendor,total\nAcme,42"
});

const samplePdfBase64 = base64Text([
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /AcroForm 10 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R 11 0 R] >> endobj",
  "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  "5 0 obj << /Length 92 >>",
  "stream",
  "BT /F1 12 Tf 72 720 Td (Standalone PDF payload parser extracts evidence.) Tj ET",
  "endstream",
  "endobj",
  "6 0 obj << /Type /Annot /Subtype /Link /Rect [72 700 248 716] /Contents (PDF evidence portal) /A << /S /URI /URI (https://example.test/pdf-evidence) >> >> endobj",
  "7 0 obj << /Type /Outlines /First 8 0 R /Last 9 0 R /Count 2 >> endobj",
  "8 0 obj << /Title (PDF Architecture Overview) /Parent 7 0 R /Dest [3 0 R /Fit] /Next 9 0 R >> endobj",
  "9 0 obj << /Title (PDF Evidence Appendix) /Parent 7 0 R /Dest [3 0 R /XYZ 72 720 0] >> endobj",
  "10 0 obj << /Fields [11 0 R] >> endobj",
  "11 0 obj << /Type /Annot /Subtype /Widget /FT /Tx /T (Project Owner) /TU (Owner field) /V (Platform Team) /Rect [72 640 260 660] /P 3 0 R >> endobj",
  "trailer << /Root 1 0 R >>",
  "%%EOF"
].join("\n"));

const previousUrl = process.env.PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL;
const reuseServiceUrl = String(process.env.PACT_VERIFY_EXTERNAL_KD_SERVICE_URL || "").replace(/\/+$/, "");
const serviceDataDir = reuseServiceUrl
  ? ""
  : await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kd-service-"));
const pactDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kd-platform-"));
const port = reuseServiceUrl ? 0 : await freePort();
const serviceUrl = reuseServiceUrl || `http://127.0.0.1:${port}`;
const service = reuseServiceUrl
  ? { async close() {} }
  : startExternalService({ port, dataDir: serviceDataDir });
let pactServer = null;
let fileRefDocument = null;
let deferredFileRefDocument = null;
let binaryProfileFileRefDocument = null;
let largeJsonFileRefDocument = null;
let mountedArchiveDocument = null;
let mountedDirectoryDocument = null;
let rawDocumentsManifestPath = "";
const mountedStructuredDocuments = [];
const mountedLegacyOfficeDocuments = [];

try {
  if (serviceDataDir) {
    const fileRefPath = path.join(serviceDataDir, "mounted-large-project.md");
    await fs.writeFile(
      fileRefPath,
      Array.from({ length: 90 }, (_, index) => (
        `Mounted project section ${index + 1}: filePath content references must avoid base64 transport and still enter route-first distillation windows.`
      )).join("\n\n")
    );
    const fileStat = await fs.stat(fileRefPath);
    fileRefDocument = {
      sourceId: "source-18",
      title: "Mounted Large Project",
      fileName: "mounted-large-project.md",
      mediaType: "text/markdown",
      byteSize: fileStat.size,
      filePath: fileRefPath
    };
    const manifestMarkdownPath = path.join(serviceDataDir, "manifest-large-project.md");
    await fs.writeFile(
      manifestMarkdownPath,
      [
        "# Manifest Project Evidence",
        ...Array.from({ length: 130 }, (_, index) => (
          `Manifest section ${index + 1}: streaming JSONL document manifests must avoid large request bodies while preserving filePath routing and windowed distillation.`
        ))
      ].join("\n\n")
    );
    const manifestCsvPath = path.join(serviceDataDir, "manifest-invoices.csv");
    await fs.writeFile(manifestCsvPath, "vendor,total,date\nManifestCo,640,2026-07-01\nManifestOps,128,2026-07-02\n");
    rawDocumentsManifestPath = path.join(serviceDataDir, "raw-documents-manifest.jsonl");
    await fs.writeFile(
      rawDocumentsManifestPath,
      [
        {
          sourceId: "manifest-md",
          title: "Manifest Markdown Project",
          fileName: "manifest-large-project.md",
          mediaType: "text/markdown",
          filePath: manifestMarkdownPath
        },
        {
          sourceId: "manifest-csv",
          title: "Manifest Invoice CSV",
          fileName: "manifest-invoices.csv",
          mediaType: "text/csv",
          filePath: manifestCsvPath
        }
      ].map((record) => JSON.stringify(record)).join("\n") + "\n"
    );
    const deferredPath = path.join(serviceDataDir, "mounted-large-binary.pdf");
    await fs.writeFile(deferredPath, Buffer.alloc((9 * 1024 * 1024) + 17, 0x25));
    const deferredStat = await fs.stat(deferredPath);
    deferredFileRefDocument = {
      sourceId: "source-19",
      title: "Mounted Large Binary PDF",
      fileName: "mounted-large-binary.pdf",
      mediaType: "application/pdf",
      byteSize: deferredStat.size,
      filePath: deferredPath
    };
    const binaryProfilePath = path.join(serviceDataDir, "mounted-unknown-large.asset");
    const binaryProfileBuffer = Buffer.alloc((9 * 1024 * 1024) + 101, 0);
    binaryProfileBuffer.write("Pact unknown binary profile should not be read fully into memory.", 0, "utf8");
    binaryProfileBuffer.write("tail-sentinel", binaryProfileBuffer.length - "tail-sentinel".length, "utf8");
    await fs.writeFile(binaryProfilePath, binaryProfileBuffer);
    const binaryProfileStat = await fs.stat(binaryProfilePath);
    binaryProfileFileRefDocument = {
      sourceId: "source-43",
      title: "Mounted Unknown Large Binary",
      fileName: "mounted-unknown-large.asset",
      mediaType: "application/octet-stream",
      byteSize: binaryProfileStat.size,
      filePath: binaryProfilePath
    };
    const largeJsonPath = path.join(serviceDataDir, "mounted-large-records.json");
    await fs.writeFile(
      largeJsonPath,
      JSON.stringify({
        project: "external knowledge distillation",
        records: Array.from({ length: 110_000 }, (_, index) => ({
          id: index + 1,
          domain: index % 2 === 0 ? "architecture" : "finance",
          evidence: `Large JSON filePath record ${index + 1} keeps structured data distillable without direct memory reads.`
        }))
      })
    );
    const largeJsonStat = await fs.stat(largeJsonPath);
    largeJsonFileRefDocument = {
      sourceId: "source-51",
      title: "Mounted Large JSON Records",
      fileName: "mounted-large-records.json",
      mediaType: "application/json",
      byteSize: largeJsonStat.size,
      filePath: largeJsonPath
    };
    const mountedDirectoryPath = path.join(serviceDataDir, "mounted-project-directory");
    await fs.mkdir(path.join(mountedDirectoryPath, "finance"), { recursive: true });
    await fs.mkdir(path.join(mountedDirectoryPath, "src"), { recursive: true });
    await fs.mkdir(path.join(mountedDirectoryPath, "node_modules", "ignored"), { recursive: true });
    await fs.writeFile(
      path.join(mountedDirectoryPath, "README.md"),
      "# Mounted Directory Project\nDirectory filePath expansion must route child documents without zipping the project first."
    );
    await fs.writeFile(
      path.join(mountedDirectoryPath, "finance", "invoices.csv"),
      "vendor,total,date\nDirectoryCo,720,2026-08-01\nDirectoryOps,144,2026-08-02\n"
    );
    await fs.writeFile(
      path.join(mountedDirectoryPath, "src", "router.js"),
      "export function routeExternalDistillation(input) { return input.service === 'external.knowledge.distillation'; }\n"
    );
    await fs.writeFile(
      path.join(mountedDirectoryPath, "node_modules", "ignored", "noise.txt"),
      "This dependency folder should be ignored by directory expansion.\n"
    );
    mountedDirectoryDocument = {
      sourceId: "source-74",
      title: "Mounted Project Directory",
      fileName: "mounted-project.directory",
      mediaType: "inode/directory",
      filePath: mountedDirectoryPath
    };
    const mountedArchivePath = path.join(serviceDataDir, "mounted-project-package.tar");
    const mountedArchiveText = Array.from({ length: 80_000 }, (_, index) => (
      `Mounted archive section ${index + 1}: archive filePath packages must expand without loading the whole project package into memory.`
    )).join("\n");
    await fs.writeFile(mountedArchivePath, tarBuffer({
      "mounted/large-project.md": `# Mounted Archive Project\n${mountedArchiveText}`,
      "mounted/invoice.csv": "vendor,total\nMountedArchiveCo,512"
    }));
    const mountedArchiveStat = await fs.stat(mountedArchivePath);
    mountedArchiveDocument = {
      sourceId: "source-20",
      title: "Mounted Archive Package",
      fileName: "mounted-project-package.tar",
      mediaType: "application/x-tar",
      byteSize: mountedArchiveStat.size,
      filePath: mountedArchivePath
    };
    const mountedStructuredSpecs = [
      {
        sourceId: "source-21",
        title: "Mounted DOCX Project Plan",
        fileName: "mounted-project-plan.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        entries: {
          "word/document.xml": [
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><w:body>",
            "<w:p><w:r><w:t>Mounted link: </w:t></w:r><w:hyperlink r:id=\"rId1\"><w:r><w:t>mounted DOCX link</w:t></w:r></w:hyperlink></w:p>",
            "<w:p><w:r><w:drawing><wp:inline><wp:docPr id=\"12\" name=\"Mounted Architecture Image\" descr=\"Mounted DOCX architecture image evidence\"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed=\"rIdImage1\"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
            "<w:p><w:ins w:id=\"12\" w:author=\"Mounted Revision Author\" w:date=\"2026-07-02T00:00:00Z\"><w:r><w:t>Mounted inserted tracked change remains agent-readable.</w:t></w:r></w:ins></w:p>",
            "<w:p><w:del w:id=\"13\" w:author=\"Mounted Revision Author\" w:date=\"2026-07-03T00:00:00Z\"><w:r><w:delText>Mounted deleted tracked change remains agent-readable.</w:delText></w:r></w:del></w:p>",
            Array.from({ length: 120 }, (_, index) => (
              `<w:p><w:r><w:t>Mounted DOCX section ${index + 1} confirms structured filePath extraction, project convergence, and evidence windowing.</w:t></w:r></w:p>`
            )).join(""),
            "</w:body></w:document>"
          ].join(""),
          "word/_rels/document.xml.rels": [
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/mounted-docx\" TargetMode=\"External\"/>",
            "<Relationship Id=\"rIdImage1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/mounted-architecture.png\"/>",
            "</Relationships>"
          ].join(""),
          "word/comments.xml": [
            "<w:comments xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:comment w:id=\"4\" w:author=\"Mounted Reviewer\"><w:p><w:r><w:t>Mounted DOCX comment remains available as agent annotation evidence.</w:t></w:r></w:p></w:comment>",
            "</w:comments>"
          ].join(""),
          "word/footnotes.xml": [
            "<w:footnotes xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:footnote w:id=\"5\"><w:p><w:r><w:t>Mounted DOCX footnote preserves filePath annotation evidence.</w:t></w:r></w:p></w:footnote>",
            "</w:footnotes>"
          ].join(""),
          "word/media/mounted-architecture.png": "mounted-docx-image-bytes",
          "word/media/noise.bin": "mounted-docx-media-noise-must-not-enter-structural-entry-plan"
        }
      },
      {
        sourceId: "source-22",
        title: "Mounted PPTX Roadmap",
        fileName: "mounted-roadmap.pptx",
        mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        entries: {
          "ppt/slides/slide1.xml": [
            "<p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
            "<p:cSld><p:spTree>",
            "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Mounted Slide Title\"/></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"457200\"/><a:ext cx=\"5486400\" cy=\"685800\"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Mounted PPTX slide route validates structured filePath parser coverage. </a:t></a:r><a:r><a:rPr><a:hlinkClick r:id=\"rId1\"/></a:rPr><a:t>mounted PPTX link</a:t></a:r></a:p></p:txBody></p:sp>",
            "<p:pic><p:nvPicPr><p:cNvPr id=\"5\" name=\"Mounted Roadmap Image\" descr=\"Mounted PPTX roadmap image evidence\"/></p:nvPicPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"2057400\"/><a:ext cx=\"1828800\" cy=\"685800\"/></a:xfrm></p:spPr><p:blipFill><a:blip r:embed=\"rIdImage1\"/></p:blipFill></p:pic>",
            "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"3\" name=\"Mounted Decision Table\"/></p:nvGraphicFramePr><p:xfrm><a:off x=\"914400\" y=\"1371600\"/><a:ext cx=\"6400800\" cy=\"914400\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl>",
            "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Owner</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Decision</a:t></a:r></a:p></a:txBody></a:tc></a:tr>",
            "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Mounted PPTX</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Preserve filePath PowerPoint table cells</a:t></a:r></a:p></a:txBody></a:tc></a:tr>",
            "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>",
            "</p:spTree></p:cSld>",
            "</p:sld>"
          ].join(""),
          "ppt/slides/_rels/slide1.xml.rels": [
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/mounted-pptx\" TargetMode=\"External\"/>",
            "<Relationship Id=\"rIdImage1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/mounted-roadmap.png\"/>",
            "<Relationship Id=\"rIdComment1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments\" Target=\"../comments/comment1.xml\"/>",
            "<Relationship Id=\"rIdLayout1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>",
            "</Relationships>"
          ].join(""),
          "ppt/slideLayouts/slideLayout1.xml": [
            "<p:sldLayout xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" type=\"titleAndContent\">",
            "<p:cSld name=\"Mounted Roadmap Layout\"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id=\"11\" name=\"Mounted Layout Placeholder\"/></p:nvSpPr><p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr><p:txBody><a:p><a:r><a:t>Mounted layout keeps inherited PowerPoint semantics queryable.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>",
            "</p:sldLayout>"
          ].join(""),
          "ppt/slideLayouts/_rels/slideLayout1.xml.rels": [
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rIdMaster1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/>",
            "</Relationships>"
          ].join(""),
          "ppt/slideMasters/slideMaster1.xml": [
            "<p:sldMaster xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
            "<p:cSld name=\"Mounted Roadmap Master\"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id=\"21\" name=\"Mounted Master Footer\"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Mounted master preserves project-level PPTX footer context.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>",
            "</p:sldMaster>"
          ].join(""),
          "ppt/commentAuthors.xml": [
            "<p:cmAuthorLst xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
            "<p:cmAuthor id=\"0\" name=\"Mounted Slide Reviewer\" initials=\"MSR\" lastIdx=\"1\"/>",
            "</p:cmAuthorLst>"
          ].join(""),
          "ppt/comments/comment1.xml": [
            "<p:cmLst xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
            "<p:cm authorId=\"0\" dt=\"2026-06-01T11:00:00Z\" idx=\"1\"><p:pos x=\"914400\" y=\"914400\"/><p:text>Mounted PPTX comment remains agent-readable.</p:text></p:cm>",
            "</p:cmLst>"
          ].join(""),
          "ppt/notesSlides/notesSlide1.xml": [
            "<p:notes xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
            "<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Mounted speaker note keeps filePath slide decisions queryable.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>",
            "</p:notes>"
          ].join(""),
          "ppt/media/mounted-roadmap.png": "mounted-pptx-image-bytes"
        }
      },
      {
        sourceId: "source-23",
        title: "Mounted XLSX Evidence Table",
        fileName: "mounted-evidence.xlsx",
        mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        entries: {
          "xl/sharedStrings.xml": [
            "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
            "<si><t>Parser</t></si><si><t>Status</t></si><si><t>Report Date</t></si><si><t>Evidence Score</t></si>",
            "<si><t>structured filePath</t></si><si><t>completed</t></si><si><t>2026-06-15</t></si>",
            "</sst>"
          ].join(""),
          "xl/styles.xml": [
            "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
            "<cellXfs count=\"2\"><xf numFmtId=\"0\"/><xf numFmtId=\"14\" applyNumberFormat=\"1\"/></cellXfs>",
            "</styleSheet>"
          ].join(""),
          "xl/workbook.xml": [
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
            "<sheets><sheet name=\"Mounted Evidence\" sheetId=\"9\" r:id=\"rIdSheet1\"/></sheets>",
            "<definedNames><definedName name=\"MountedEvidenceRange\" localSheetId=\"0\">'Mounted Evidence'!$A$1:$D$2</definedName></definedNames>",
            "</workbook>"
          ].join(""),
          "xl/_rels/workbook.xml.rels": [
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rIdSheet1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>",
            "</Relationships>"
          ].join(""),
          "xl/worksheets/sheet1.xml": [
            "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
            "<sheetData><row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c><c t=\"s\"><v>2</v></c><c t=\"s\"><v>3</v></c></row><row><c t=\"s\"><v>4</v></c><c t=\"s\"><v>5</v></c><c r=\"C2\" s=\"1\"><v>46188</v></c><c r=\"D2\"><f>LEN(B2)</f><v>9</v></c></row></sheetData>",
            "<mergeCells count=\"1\"><mergeCell ref=\"A1:B1\"/></mergeCells>",
            "<hyperlinks><hyperlink ref=\"B2\" r:id=\"rId1\" display=\"completed evidence\"/></hyperlinks>",
            "</worksheet>"
          ].join(""),
          "xl/worksheets/_rels/sheet1.xml.rels": [
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/container-xlsx\" TargetMode=\"External\"/>",
            "<Relationship Id=\"rIdComment1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments\" Target=\"../comments1.xml\"/>",
            "</Relationships>"
          ].join(""),
          "xl/comments1.xml": [
            "<comments xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
            "<authors><author>Mounted Analyst</author></authors>",
            "<commentList><comment ref=\"B2\" authorId=\"0\"><text><r><t>Mounted XLSX status comment remains queryable.</t></r></text></comment></commentList>",
            "</comments>"
          ].join("")
        }
      },
      {
        sourceId: "source-24",
        title: "Mounted OpenDocument Notes",
        fileName: "mounted-notes.odt",
        mediaType: "application/vnd.oasis.opendocument.text",
        entries: {
          "mimetype": "application/vnd.oasis.opendocument.text",
          "content.xml": [
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
            "<office:body><office:text><text:p>Mounted OpenDocument filePath parser keeps ODT evidence in the distillation corpus. <text:a xlink:href=\"https://example.com/mounted-odf\">mounted ODF link</text:a></text:p></office:text></office:body>",
            "</office:document-content>"
          ].join("")
        }
      },
      {
        sourceId: "source-25",
        title: "Mounted EPUB Handbook",
        fileName: "mounted-handbook.epub",
        mediaType: "application/epub+zip",
        entries: {
          "mimetype": "application/epub+zip",
          "META-INF/container.xml": "<?xml version=\"1.0\"?><container version=\"1.0\"></container>",
          "OEBPS/chapter1.xhtml": [
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>",
            "<h1>Mounted EPUB Evidence</h1>",
            "<p>Mounted EPUB chapter routing verifies ebook filePath distillation compatibility.</p>",
            "</body></html>"
          ].join("")
        }
      },
      {
        sourceId: "source-42",
        title: "Mounted Large DOCX Structural XML",
        fileName: "mounted-large-structured.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        entries: {
          "word/document.xml": [
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>",
            Array.from({ length: 700 }, (_, index) => (
              `<w:p><w:r><w:t>Large mounted DOCX structural paragraph ${index + 1} proves oversized WordprocessingML streams through bounded filePath parsing without whole-entry memory reads.</w:t></w:r></w:p>`
            )).join(""),
            "</w:body></w:document>"
          ].join("")
        }
      }
    ];
    for (const spec of mountedStructuredSpecs) {
      const filePath = path.join(serviceDataDir, spec.fileName);
      await fs.writeFile(filePath, zipBuffer(spec.entries));
      const stat = await fs.stat(filePath);
      mountedStructuredDocuments.push({
        sourceId: spec.sourceId,
        title: spec.title,
        fileName: spec.fileName,
        mediaType: spec.mediaType,
        byteSize: stat.size,
        filePath
      });
    }
    const largeLegacyRtf = [
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24",
      Array.from({ length: 90_000 }, (_, index) => (
        `Mounted legacy DOC paragraph ${index + 1} proves Tika filePath extraction avoids direct memory reads for oversized Office payloads.\\par`
      )).join("\n"),
      "}"
    ].join("\n");
    const mountedLegacySpecs = [
      {
        sourceId: "source-30",
        title: "Mounted Legacy DOC",
        fileName: "mounted-legacy-large.doc",
        mediaType: "application/msword",
        content: largeLegacyRtf
      },
      {
        sourceId: "source-31",
        title: "Mounted RTF Notes",
        fileName: "mounted-notes.rtf",
        mediaType: "application/rtf",
        content: "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Mounted RTF filePath extraction keeps legacy text distillable.\\par}"
      },
      {
        sourceId: "source-32",
        title: "Mounted Legacy PPT",
        fileName: "mounted-legacy.ppt",
        mediaType: "application/vnd.ms-powerpoint",
        content: "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Mounted legacy PPT route uses Tika filePath extraction.\\par}"
      },
      {
        sourceId: "source-33",
        title: "Mounted Legacy XLS",
        fileName: "mounted-legacy.xls",
        mediaType: "application/vnd.ms-excel",
        content: "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Mounted legacy XLS route uses Tika filePath extraction.\\par}"
      }
    ];
    for (const spec of mountedLegacySpecs) {
      const filePath = path.join(serviceDataDir, spec.fileName);
      await fs.writeFile(filePath, spec.content);
      const stat = await fs.stat(filePath);
      mountedLegacyOfficeDocuments.push({
        sourceId: spec.sourceId,
        title: spec.title,
        fileName: spec.fileName,
        mediaType: spec.mediaType,
        byteSize: stat.size,
        filePath
      });
    }
  }
  await waitForService(serviceUrl);
  const directRuntime = await fetchJson(`${serviceUrl}/v1/runtime/health`);
  assert.equal(directRuntime.status, 200);
  assert.equal(directRuntime.payload.protocolVersion, "pact.external-knowledge-distillation.v1.runtime-doctor");
  assert.ok(directRuntime.payload.runtimes["tika.app"], "runtime doctor must report Tika fallback runtime state");
  assert.ok(directRuntime.payload.runtimes["ocr.tesseract"], "runtime doctor must report image OCR runtime state");
  assert.ok(directRuntime.payload.runtimes["pdf.pymupdf"], "runtime doctor must report PDF visual runtime state");
  assert.ok(directRuntime.payload.runtimes["pdf.pdftotext"], "runtime doctor must report PDF file-ref text extraction runtime state");
  const directGapReport = await fetchJson(`${serviceUrl}/v1/reference-gap-report`);
  assert.equal(directGapReport.status, 200);
  assert.equal(directGapReport.payload.strategy, "reference-framework-gap-report.v1");
  assert.equal(directGapReport.payload.referenceFrameworks.count >= 6, true);
  assert.equal(directGapReport.payload.referenceFrameworks.localAudit.strategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(directGapReport.payload.referenceFrameworks.localAudit.auditCommand, "npm run server:external-kd:references");
  assert.equal(directGapReport.payload.referenceFrameworks.localAudit.syncCommand, "npm run server:external-kd:sync-references");
  assert.equal(directGapReport.payload.referenceFrameworks.localAudit.presentCount >= 6, true);
  assert.equal(directGapReport.payload.referenceFrameworks.localAudit.commitMatchCount >= 6, true);
  assert.equal(directGapReport.payload.frameworks.some((framework) => framework.id === "graphrag" && framework.absorbedPatterns.length > 0), true);
  assert.equal(directGapReport.payload.frameworks.some((framework) => framework.id === "docling" && framework.localAudit?.commitMatches === true), true);
  const directReferenceFrameworks = await fetchJson(`${serviceUrl}/v1/reference-frameworks`);
  assert.equal(directReferenceFrameworks.status, 200);
  assert.equal(directReferenceFrameworks.payload.localAudit.strategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(directReferenceFrameworks.payload.localAudit.auditCommand, "npm run server:external-kd:references");
  assert.equal(directReferenceFrameworks.payload.localAudit.syncCommand, "npm run server:external-kd:sync-references");
  assert.equal(directReferenceFrameworks.payload.localAudit.frameworks.every((framework) => framework.syncCommand.includes("--only")), true);
  assert.equal(directReferenceFrameworks.payload.localAudit.frameworks.some((framework) => framework.id === "unstructured" && framework.commitMatches === true), true);

  process.env.PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL = serviceUrl;
  pactServer = await startHttpServer({
    userDataPath: pactDataDir,
    distPath: "",
    port: 0,
    runtimeOptions: { profile: "minimal" }
  });
  const auth = await installAuthenticatedFetch(pactServer);

  const interfaces = await fetchJson(`${pactServer.url}/api/interfaces`, {
    headers: authHeaders(auth)
  });
  assert.equal(interfaces.status, 200);
  const runtimeOperationIds = new Set(interfaces.payload.interfaces.map((item) => item.id));
  for (const operationId of requiredOperationIds) {
    assert.equal(runtimeOperationIds.has(operationId), true, `${operationId} must be visible through /api/interfaces`);
  }

  const health = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/health`, {
    headers: authHeaders(auth)
  });
  assert.equal(health.status, 200);
  assert.equal(health.payload.serviceKind, "externalKnowledgeDistillation");
  assert.equal(health.payload.pactRegistration.namespace, "external.knowledge.distillation");
  assert.ok(health.payload.runtimeDoctor.summary, "health response must expose runtime doctor summary");
  assertExternalGatewayCall(health.payload, {
    serviceUrl,
    method: "GET",
    path: "/health"
  });

  const capabilities = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/capabilities`, {
    headers: authHeaders(auth)
  });
  assert.equal(capabilities.status, 200);
  assertExternalGatewayCall(capabilities.payload, {
    serviceUrl,
    method: "GET",
    path: "/v1/capabilities"
  });
  assert.equal(capabilities.payload.api.createRun, "POST /v1/distillation/runs");
  assert.equal(capabilities.payload.api.evidenceQuery, "GET /v1/distillation/runs/:runId/evidence");
  assert.equal(capabilities.payload.api.projectEvidenceQuery, "GET /v1/projects/:projectId/evidence");
  assert.equal(capabilities.payload.api.referenceGapReport, "GET /v1/reference-gap-report");
  assert.equal(capabilities.payload.classification.supported, true);
  assert.equal(capabilities.payload.responseProfiles.includes("agent"), true);
  assert.equal(capabilities.payload.workflowScopes.requestField, "workflowScope");
  assert.deepEqual(capabilities.payload.workflowScopes.enumValues, ["document", "corpus", "project"]);
  assert.equal(capabilities.payload.workflowScopes.defaultValue, "project");
  assert.equal(capabilities.payload.workflowScopes.documentSelectorFields.includes("sourceId"), true);
  assert.equal(capabilities.payload.timeFiltering.supported, true);
  assert.equal(capabilities.payload.timeFiltering.strategy, "document-window-time-filter.v1");
  assert.equal(capabilities.payload.timeFiltering.timeFields.includes("eventTime"), true);
  assert.equal(capabilities.payload.fileCompatibility.routingStrategy, "content-signature-extension-media-shape-routing.v2");
  assert.equal(capabilities.payload.fileCompatibility.routeOrder[0], "contentSignature");
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.strategy, "content-signature-routing.v1");
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("pdf-header"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("zip-ooxml-word"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("zip-ooxml-presentation"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("zip-ooxml-visio"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("zip-ooxml-spreadsheet"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.fields.includes("parserTrace[].stage=content.signature"), true);
  assert.equal(capabilities.payload.fileCompatibility.pdfSubtypeRouting.strategy, "pdf-subtype-routing.v1");
  assert.equal(capabilities.payload.fileCompatibility.pdfSubtypeRouting.subtypes.includes("pdf-scanned"), true);
  assert.equal(capabilities.payload.largeDocumentPolicy.strategy, "streaming-windowed");
  assert.equal(capabilities.payload.largeDocumentPolicy.manifestStrategy, "inline-or-streaming-manifest-document-input.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.structuredZipFileRefStrategy, "structured-zip-entry-bounded-or-streaming.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.directoryFileRefStrategy, "directory-file-ref-recursive-routing.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.directoryExpansionMaxFiles >= 1000, true);
  assert.equal(capabilities.payload.largeDocumentPolicy.binaryProfileStrategy, "bounded-binary-file-profile.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.structuredJsonFileRefStrategy, "structured-json-file-ref-streaming-window.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.manifestMaxDocuments >= 1000, true);
  assert.equal(capabilities.payload.parserExecution.payloadModes.includes("contentBase64"), true);
  assert.equal(capabilities.payload.parserExecution.payloadModes.includes("filePath"), true);
  assert.equal(capabilities.payload.parserExecution.payloadModes.includes("contentRef"), true);
  assert.equal(capabilities.payload.parserExecution.payloadModes.includes("rawDocumentsManifestPath"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("input.manifest.jsonl"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("input.manifest.json"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("content.signature"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("payload.file-ref"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("payload.file-ref-deferred"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("payload.file-ref-binary-profile"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("payload.stream-text"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("config.key-value"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("diagram.structure"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("notebook.cells"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("code.structure"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("diff.unified"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("calendar.ics"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("transcript.cues"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("transcript.webvtt"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("transcript.srt"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("xbrl.facts"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("audio.metadata"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("audio.transcript-sidecar"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("markup.structure"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured.json.file-ref-stream"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured-zip.file-ref"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured-zip.structural-entry-plan"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured-zip.large-entry-stream"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("directory.file-ref.expand"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("directory.entry-file-ref"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.text.basic"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.text.pdftotext"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.subtype-route"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.outlines"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.form-fields"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("tika.text.app"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.tables"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.headers-footers"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.content-controls"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.bookmarks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.annotations"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.revisions"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.images"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.charts"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.styles"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.numbering"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.layouts"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.placeholders"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.tables"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.images"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.charts"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.speaker-notes"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.comments"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.visio.pages"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.visio.shapes"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.visio.connectors"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.visio.text"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.expand-route"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.child-file.route"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.file-ref.expand"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.entry-file-ref"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.tar.container"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.gzip.decompress"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.7z.extract"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("email.msg.tika"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("email.mbox"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("email.attachment-route"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("open-document.structured"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("open-document.tables"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("open-document.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("ebook.epub"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.workbook.sheets"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.workbook.defined-names"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.headers"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.cells"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.merged-cells"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.comments"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.date-styles"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.formulas"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("table.sheet.charts"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("tika.text.file-ref"), true);
  assert.equal(capabilities.payload.parserExecution.emptyCorpusErrorCode, "EMPTY_RAW_CORPUS");
  assert.ok(capabilities.payload.runtimeDoctor.summary, "capabilities must expose runtime doctor summary");
  assert.equal(capabilities.payload.classification.strategy, "hashing_embedding_window_community_classification_v3");
  assert.equal(capabilities.payload.classification.taxonomyStrategy, "semantic-concept-topic-hierarchy.v1");
  assert.equal(capabilities.payload.classification.assignmentRationaleStrategy, "leader-clustering-semantic-concept-rationale.v1");
  assert.equal(capabilities.payload.classification.embedding.dimensions, 128);
  assert.equal(capabilities.payload.classification.embedding.windowCommunityThreshold, 0.31);
  assert.equal(capabilities.payload.classification.referencePatterns.includes("graphrag.community-reports"), true);
  assert.equal(capabilities.payload.grounding.strategy, "claim-evidence-topk-conflict-gating.v2");
  assert.equal(capabilities.payload.grounding.promotionGate, "claim-grounded-promotion");
  assert.equal(capabilities.payload.incrementalConvergence.supported, true);
  assert.equal(capabilities.payload.incrementalConvergence.strategy, "project-snapshot-incremental-convergence.v1");
  assert.equal(capabilities.payload.artifacts.includes("project-snapshot-json"), true);
  assert.equal(capabilities.payload.graphEvidence.supported, true);
  assert.equal(capabilities.payload.graphEvidence.strategy, "graph-lite-entity-relationship-evidence-pack.v1");
  assert.equal(capabilities.payload.graphEvidence.tables.includes("relationships"), true);
  assert.equal(capabilities.payload.graphEvidence.query.supported, true);
  assert.equal(capabilities.payload.graphEvidence.query.strategy, "graph-lite-evidence-query.v1");
  assert.equal(capabilities.payload.graphEvidence.query.filters.includes("entity"), true);
  assert.equal(capabilities.payload.graphEvidence.projectQuery.supported, true);
  assert.equal(capabilities.payload.graphEvidence.projectQuery.strategy, "project-graph-evidence-convergence-query.v1");
  assert.equal(capabilities.payload.graphEvidence.projectQuery.modes.includes("all"), true);
  assert.equal(capabilities.payload.graphEvidence.query.filters.includes("domain"), true);
  assert.equal(capabilities.payload.graphEvidence.projectQuery.filters.includes("routeId"), true);
  assert.equal(capabilities.payload.graphEvidence.projectQuery.readModel, "domain-topic-community-source-time.v1");
  assert.equal(capabilities.payload.artifacts.includes("portable-docx"), true);
  assert.equal(capabilities.payload.artifacts.includes("console-summary-json"), true);
  assert.equal(capabilities.payload.artifacts.includes("workspace-package-zip"), true);
  assert.equal(capabilities.payload.artifacts.includes("evidence-pack-json"), true);
  assert.equal(capabilities.payload.artifacts.includes("format-conversion-plan-json"), true);
  assert.equal(capabilities.payload.artifacts.includes("professional-format-manifest-json"), true);
  assert.equal(capabilities.payload.artifacts.includes("reference-gap-report-json"), true);
  assert.equal(capabilities.payload.responseProfileSeparation.strategy, "human-agent-response-profile-separation.v1");
  assert.equal(capabilities.payload.responseProfileSeparation.humanReadable.artifacts.includes("console-summary-json"), true);
  assert.equal(capabilities.payload.responseProfileSeparation.agentReadable.artifacts.includes("professional-format-manifest-json"), true);
  assert.equal(capabilities.payload.referenceGapReport.strategy, "reference-framework-gap-report.v1");
  assert.equal(capabilities.payload.referenceGapReport.localAuditStrategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(capabilities.payload.elementModel.supported, true);
  assert.equal(capabilities.payload.elementModel.strategy, "document-element-model.v1");
  assert.equal(capabilities.payload.elementModel.windowingStrategy, "element-aware-by-title-windowing.v1");
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("bbox"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("layout.width"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.ref"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.dateIso"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.dateSerial"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.formula"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.hyperlink.target"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("merge.ref"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.merge.ref"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.comment.ref"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("image.target"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("image.relationshipId"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("chart.chartPart"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("chart.series"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("form.name"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("form.value"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("control.tag"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("bookmark.name"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("headerFooter.kind"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("headerFooter.partName"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("definedName.ref"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("definedName.builtinType"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("codeBlock.language"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("quote.depth"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("table.sheetName"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("table.sheetId"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("shape.placeholderType"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("shape.type"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("shape.master"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("presentation.layoutPart"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("presentation.masterPart"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("pdf-outline"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("pdf-form-field"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("slide-layout"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("slide-master"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("slide-shape"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("speaker-note"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("visio-shape"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("visio-connector"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("comment"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("revision"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("footnote"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("link"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("chart"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("content-control"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("bookmark"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("header"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("footer"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("defined-name"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("frontmatter"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("merged-cell"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("cell-comment"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("transcript-cue"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("speaker-turn"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("xbrl-fact"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.href"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.frontmatter"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.annotation"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.style.styleId"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.style.numberingId"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.shape.placeholderType"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.shape.type"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.presentation.layoutPart"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.presentation.masterPart"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.table.sheetName"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.image.target"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.image.relationshipId"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.chart.chartPart"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.chart.series"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.form.name"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.form.value"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.control.tag"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.bookmark.name"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.headerFooter.kind"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.headerFooter.partName"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.definedName.ref"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.definedName.builtinType"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.codeBlock.language"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.quote.depth"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.merge.ref"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.merge"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.comment"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.dateIso"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.dateSerial"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.transcript.speaker"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.xbrlFact.contextRef"), true);
  assert.equal(capabilities.payload.elementModel.structuredFormats.includes("pdf"), true);
  assert.equal(capabilities.payload.elementModel.structuredFormats.includes("markdown"), true);
  assert.equal(capabilities.payload.elementModel.structuredFormats.includes("vsdx"), true);
  assert.equal(capabilities.payload.elementModel.structuredFormats.includes("webvtt"), true);
  assert.equal(capabilities.payload.elementModel.structuredFormats.includes("xbrl"), true);
  assert.equal(capabilities.payload.elementModel.referencePatterns.includes("unstructured.chunk_by_title"), true);
  assert.equal(capabilities.payload.algorithms.includes("element-aware-by-title-windowing.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("structured-json-file-ref-streaming-window.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("directory-file-ref-recursive-routing.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("pdf-subtype-routing.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("content-signature-routing.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("human-agent-response-profile-separation.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("professional-format-manifest.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("bounded-binary-file-profile.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("visio-opc-shape-parser.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("timed-transcript-cue-parser.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("xbrl-financial-fact-parser.v1"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("markdown.frontmatter"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("markdown.structure"), true);
  assert.equal(capabilities.payload.formatConversion.strategy, "office-document-professional-adaptation.v1");
  assert.equal(capabilities.payload.formatConversion.qualityGateEvaluationStrategy, "professional-format-quality-gates.v1");
  assert.equal(capabilities.payload.formatConversion.outputArtifactValidationStrategy, "format-conversion-output-artifact-self-check.v1");
  assert.equal(capabilities.payload.formatConversion.artifact, "format-conversion-plan-json");
  assert.equal(capabilities.payload.formatConversion.professionalManifestArtifact, "professional-format-manifest-json");
  assert.equal(capabilities.payload.formatConversion.modeSeparationStrategy, "human-agent-response-profile-separation.v1");
  assert.equal(capabilities.payload.formatConversion.professionalFormats.includes("pdf"), true);
  assert.equal(capabilities.payload.formatConversion.professionalFormats.includes("word"), true);
  assert.equal(capabilities.payload.formatConversion.professionalFormats.includes("presentation"), true);
  assert.equal(capabilities.payload.formatConversion.professionalFormats.includes("visio"), true);
  assert.equal(capabilities.payload.formatConversion.professionalFormats.includes("spreadsheet"), true);
  assert.equal(capabilities.payload.formatConversion.professionalFormats.includes("markdown"), true);
  assert.equal(capabilities.payload.formatConversion.humanReadableTargets.includes("portable-docx"), true);
  assert.equal(capabilities.payload.formatConversion.agentReadableTargets.includes("evidence-pack-json"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("frontmatter"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("codeBlocks"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("blockquotes"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("charts"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("chartSeries"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("formFields"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("contentControls"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("bookmarks"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("headers"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("footers"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("slide-layout"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("slide-master"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("shapeConnectors"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("definedNames"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("namedRanges"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("printAreas"), true);
  for (const [routeId, parserProfile, qualityGate] of [
    ["pdf", "pdf.text-layout-ocr-route", "page-order-preserved"],
    ["word", "wordprocessingml-paragraph-style-route", "word-annotation-refs-preserved"],
    ["presentation", "presentationml-slide-route", "slide-order-preserved"],
    ["visio", "visio-opc-page-shape-route", "visio-shape-refs-preserved"],
    ["spreadsheet", "spreadsheetml-sheet-row-cell-route", "sheet-row-cell-refs-preserved"],
    ["markdown", "markdown-block-element-route", "heading-tree-preserved"]
  ]) {
    const adapter = capabilities.payload.formatConversion.formatMatrix.find((item) => item.routeId === routeId);
    assert.ok(adapter, `${routeId} must have a professional format adapter`);
    assert.equal(adapter.parserProfile, parserProfile);
    assert.equal(adapter.conversionAdapters.some((item) => item.targetFormat === "docx"), true);
    assert.equal(adapter.qualityGates.includes(qualityGate), true);
  }
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("docx-openxml-package-valid"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("pdf-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("pdf-outline-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("pdf-form-fields-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-paragraph-style-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-list-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-content-control-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-bookmark-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-header-footer-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-image-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-chart-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-revision-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-image-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-frontmatter-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-code-blocks-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-blockquote-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-layout-master-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-placeholder-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-image-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-chart-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-comment-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("visio-page-order-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("visio-shape-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("visio-connector-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("opendocument-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-workbook-sheet-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-defined-name-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-merged-cell-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-comment-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-date-serials-normalized"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-hyperlink-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-chart-refs-preserved"), true);
  for (const extension of [".pdf", ".docx", ".docm", ".dotx", ".dotm", ".doc", ".dot", ".rtf", ".xlsx", ".xlsm", ".xlsb", ".xltx", ".xltm", ".pptx", ".pptm", ".ppsx", ".ppsm", ".potx", ".potm", ".ppt", ".pps", ".pot", ".vsdx", ".vsdm", ".vssx", ".vssm", ".vstx", ".vstm", ".vsd", ".vss", ".vst", ".vdx", ".odt", ".ods", ".odp", ".epub", ".eml", ".msg", ".mbox", ".png", ".gif", ".pgm", ".zip", ".tar", ".tgz", ".tar.gz", ".7z", ".directory", ".pages", ".numbers", ".key", ".xcodeproj", ".xcworkspace", ".md", ".json", ".jsonc", ".ipynb", ".yaml", ".toml", ".ini", ".properties", ".env", ".svg", ".drawio", ".mmd", ".mermaid", ".puml", ".plantuml", ".js", ".ts", ".py", ".go", ".rs", ".diff", ".patch", ".ics", ".vcs", ".vtt", ".webvtt", ".srt", ".xbrl", ".ixbrl", ".wav", ".mp3", ".m4a", ".html", ".htm", ".xhtml", ".xml", ".rst", ".adoc", ".asciidoc", ".org", ".tex", ".latex", ".wiki", ".mediawiki"]) {
    assert.equal(
      capabilities.payload.fileCompatibility.supportedExtensions.includes(extension),
      true,
      `${extension} must be advertised as a routed file format`
    );
  }
  const pdfFormat = capabilities.payload.fileCompatibility.formats.find((format) => format.id === "pdf");
  assert.ok(pdfFormat, "PDF route must be described in capabilities");
  assert.equal(pdfFormat.preferredParser, "pdf.text.tika-safe");
  assert.equal(pdfFormat.fallbackParsers.includes("ocr.page"), true);
  assert.ok(
    capabilities.payload.referenceFrameworks.frameworks.length >= 6,
    "external service must expose local reference framework baseline"
  );
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.strategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.auditCommand, "npm run server:external-kd:references");
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.syncCommand, "npm run server:external-kd:sync-references");
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.presentCount >= 6, true);
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.commitMatchCount >= 6, true);

  const runtimeHealth = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runtime/health`, {
    headers: authHeaders(auth)
  });
  assert.equal(runtimeHealth.status, 200);
  assert.equal(runtimeHealth.payload.protocolVersion, "pact.external-knowledge-distillation.v1.runtime-doctor");
  assert.equal(runtimeHealth.payload.pactRegistration.namespace, "external.knowledge.distillation");
  assert.ok(runtimeHealth.payload.runtimes["tika.app"], "platform runtime health must proxy Tika fallback runtime state");
  assert.ok(runtimeHealth.payload.runtimes["ocr.tesseract"], "platform runtime health must proxy OCR runtime state");
  assertExternalGatewayCall(runtimeHealth.payload, {
    serviceUrl,
    method: "GET",
    path: "/v1/runtime/health"
  });

  const createRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "外部知识蒸馏注册验证 [Agent contract](https://example.test/agent)",
      title: "外部知识蒸馏注册验证",
      rawDocumentsManifestPath: rawDocumentsManifestPath || undefined,
      rawDocuments: [
        {
          sourceId: "source-1",
          title: "Architecture",
          fileName: "architecture.md",
          mediaType: "text/markdown",
          byteSize: 2048,
          text: "External service APIs must use the external.knowledge.distillation namespace to avoid colliding with internal knowledge.distillation APIs."
        },
        {
          sourceId: "source-2",
          title: "Invoice",
          fileName: "invoice.xlsx",
          mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          byteSize: 131072,
          text: "Finance invoices, payment dates, vendors, and tax totals must be distilled separately from platform architecture notes."
        },
        {
          sourceId: "source-3",
          title: "Large PDF Manual",
          fileName: "manual.pdf",
          mediaType: "application/pdf",
          byteSize: 80 * 1024 * 1024,
          text: largePdfText
        },
        {
          sourceId: "source-4",
          title: "Screenshot",
          fileName: "capture.png",
          mediaType: "image/png",
          byteSize: 2 * 1024 * 1024,
          text: "A screenshot shows an OCR recovery warning and a page-level parser trace that should stay separate from invoice data."
        },
        {
          sourceId: "source-5",
          title: "Markdown Payload",
          fileName: "payload.md",
          mediaType: "text/markdown",
          contentBase64: base64Text([
            "---",
            "owner: platform",
            "tags: [agent, routing]",
            "review_date: 2026-07-12",
            "---",
            "# Payload Routing",
            "Markdown contentBase64 must be parsed without Tika and converted with block structure.",
            "- Preserve list evidence.",
            "> Agent mode must preserve quoted operational warnings.",
            "[Agent contract](https://example.test/agent)",
            "![Architecture diagram](https://example.test/architecture.png)",
            "",
            "| Stage | Status |",
            "| --- | --- |",
            "| markdown.structure | completed |",
            "",
            "```ts",
            "const profile = 'agent';",
            "```"
          ].join("\n"))
        },
        {
          sourceId: "source-6",
          title: "JSON Payload",
          fileName: "payload.json",
          mediaType: "application/json",
          contentBase64: base64Text(JSON.stringify({ decision: "agent profile", owner: "external service" }))
        },
        {
          sourceId: "source-7",
          title: "CSV Payload",
          fileName: "payload.csv",
          mediaType: "text/csv",
          contentBase64: base64Text("vendor,total,payment_date\nAcme,42,2026-05-31\nGlobex,91,2026-06-30")
        },
        {
          sourceId: "source-28",
          title: "Service Configuration",
          fileName: "service.toml",
          mediaType: "application/toml",
          contentBase64: base64Text([
            "[service]",
            "name = \"external-kd\"",
            "workers = 4",
            "[parser]",
            "strategy = \"route-first\"",
            "fallback = \"traceable\""
          ].join("\n"))
        },
        {
          sourceId: "source-29",
          title: "Architecture Diagram",
          fileName: "architecture.drawio",
          mediaType: "application/vnd.jgraph.mxfile",
          contentBase64: base64Text([
            "<mxfile>",
            "  <diagram name=\"External Distillation\">",
            "    <mxGraphModel><root>",
            "      <mxCell id=\"0\" />",
            "      <mxCell id=\"1\" parent=\"0\" />",
            "      <mxCell id=\"api\" value=\"External API\" vertex=\"1\" parent=\"1\" />",
            "      <mxCell id=\"agent\" value=\"Agent Message\" vertex=\"1\" parent=\"1\" />",
            "      <mxCell id=\"evidence\" value=\"Graph Evidence Pack\" vertex=\"1\" parent=\"1\" />",
            "      <mxCell id=\"edge-api-agent\" value=\"agent request\" edge=\"1\" source=\"api\" target=\"agent\" parent=\"1\" />",
            "      <mxCell id=\"edge-api-evidence\" value=\"grounded query\" edge=\"1\" source=\"api\" target=\"evidence\" parent=\"1\" />",
            "    </root></mxGraphModel>",
            "  </diagram>",
            "</mxfile>"
          ].join("\n"))
        },
        {
          sourceId: "source-34",
          title: "Experiment Notebook",
          fileName: "experiment.ipynb",
          mediaType: "application/x-ipynb+json",
          contentBase64: base64Text(JSON.stringify({
            cells: [
              {
                cell_type: "markdown",
                source: [
                  "# Distillation Experiment\n",
                  "The notebook records evaluation metrics for external knowledge distillation and classification routing."
                ]
              },
              {
                cell_type: "code",
                execution_count: 1,
                source: [
                  "accuracy = 0.91\n",
                  "grounding_recall = 0.87\n",
                  "print('experiment accuracy', accuracy)"
                ],
                outputs: [
                  {
                    output_type: "stream",
                    name: "stdout",
                    text: ["experiment accuracy 0.91\n"]
                  }
                ]
              }
            ],
            metadata: {
              kernelspec: { name: "python3", language: "python" },
              language_info: { name: "python" }
            },
            nbformat: 4,
            nbformat_minor: 5
          }))
        },
        {
          sourceId: "source-35",
          title: "Distillation Runtime Source",
          fileName: "runtime.ts",
          mediaType: "text/x-source-code",
          contentBase64: base64Text([
            "import { createServer } from 'node:http';",
            "import { buildEvidencePack } from './graph-evidence';",
            "",
            "export interface RuntimeOptions {",
            "  responseProfile: 'agent' | 'console' | 'api';",
            "}",
            "",
            "export class DistillationRuntime {",
            "  constructor(private readonly options: RuntimeOptions) {}",
            "  async routeSource(source: unknown) {",
            "    // TODO: preserve parser trace for code-aware evidence.",
            "    return buildEvidencePack(source);",
            "  }",
            "}",
            "",
            "export function startServer(port: number) {",
            "  return createServer().listen(port);",
            "}"
          ].join("\n"))
        },
        {
          sourceId: "source-36",
          title: "Runtime Change Patch",
          fileName: "runtime.patch",
          mediaType: "text/x-patch",
          contentBase64: base64Text([
            "diff --git a/src/runtime.ts b/src/runtime.ts",
            "index 1a2b3c4..5d6e7f8 100644",
            "--- a/src/runtime.ts",
            "+++ b/src/runtime.ts",
            "@@ -8,7 +8,10 @@ export class DistillationRuntime {",
            "   async routeSource(source: unknown) {",
            "-    return buildEvidencePack(source);",
            "+    const routed = await routeByFormat(source);",
            "+    const evidence = buildEvidencePack(routed);",
            "+    evidence.parserTrace.push('diff.unified');",
            "+    return evidence;",
            "   }",
            " }"
          ].join("\n"))
        },
        {
          sourceId: "source-37",
          title: "Release Planning Calendar",
          fileName: "release.ics",
          mediaType: "text/calendar",
          contentBase64: base64Text([
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Pact//External KD//EN",
            "BEGIN:VEVENT",
            "UID:release-20260615@example.test",
            "DTSTART:20260615T090000Z",
            "DTEND:20260615T100000Z",
            "SUMMARY:Knowledge distillation release review",
            "LOCATION:Platform Room",
            "ORGANIZER:mailto:owner@example.test",
            "DESCRIPTION:Review route-first parsing, agent response profile, and project convergence evidence.",
            "END:VEVENT",
            "BEGIN:VTODO",
            "UID:todo-20260616@example.test",
            "DUE:20260616T170000Z",
            "SUMMARY:Ship calendar parser verification",
            "DESCRIPTION:Add calendar.ics verifier coverage.",
            "END:VTODO",
            "END:VCALENDAR"
          ].join("\n"))
        },
        {
          sourceId: "source-71",
          title: "Architecture Review Transcript",
          fileName: "architecture-review.vtt",
          mediaType: "text/vtt",
          contentBase64: base64Text([
            "WEBVTT",
            "",
            "intro",
            "00:00:01.000 --> 00:00:05.000",
            "<v Architect>External knowledge distillation must route transcript files as cue-level evidence.",
            "",
            "00:00:05.500 --> 00:00:11.000",
            "<v Finance Lead>Finance XBRL facts should remain separate from architecture review dialogue."
          ].join("\n"))
        },
        {
          sourceId: "source-72",
          title: "Quarterly XBRL Facts",
          fileName: "quarterly-facts.xbrl",
          mediaType: "application/xbrl+xml",
          contentBase64: base64Text([
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<xbrli:xbrl xmlns:xbrli=\"http://www.xbrl.org/2003/instance\" xmlns:us-gaap=\"http://fasb.org/us-gaap/2026\" xmlns:iso4217=\"http://www.xbrl.org/2003/iso4217\">",
            "  <xbrli:context id=\"FY2026Q2\"><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>",
            "  <xbrli:unit id=\"USD\"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>",
            "  <us-gaap:Revenue contextRef=\"FY2026Q2\" unitRef=\"USD\" decimals=\"-3\">4200000</us-gaap:Revenue>",
            "  <us-gaap:OperatingIncomeLoss contextRef=\"FY2026Q2\" unitRef=\"USD\" decimals=\"-3\">870000</us-gaap:OperatingIncomeLoss>",
            "</xbrli:xbrl>"
          ].join("\n"))
        },
        {
          sourceId: "source-73",
          title: "Architecture Review Audio",
          fileName: "architecture-review.wav",
          mediaType: "audio/wav",
          byteSize: 44,
          contentBase64: Buffer.concat([
            Buffer.from("RIFF", "ascii"),
            Buffer.alloc(4),
            Buffer.from("WAVEfmt ", "ascii"),
            Buffer.alloc(32)
          ]).toString("base64")
        },
        {
          sourceId: "source-38",
          title: "Markup Operations Page",
          fileName: "ops-page.html",
          mediaType: "text/html",
          contentBase64: base64Text([
            "<!doctype html>",
            "<html><head><title>External Distillation Operations</title></head><body>",
            "<article>",
            "<h1>External knowledge distillation operations</h1>",
            "<p>The HTML document records markup.structure parsing for route-first ingestion.</p>",
            "<h2>Parser checklist</h2>",
            "<ul><li>Preserve headings as elements.</li><li>Preserve agent links and table rows.</li></ul>",
            "<p>See <a href=\"https://example.test/agent\">agent contract</a> for machine-readable output.</p>",
            "<table><tr><th>Stage</th><th>Status</th></tr><tr><td>markup.structure</td><td>completed</td></tr></table>",
            "<pre>responseProfile = \"agent\"</pre>",
            "</article>",
            "</body></html>"
          ].join("\n"))
        },
        {
          sourceId: "source-39",
          title: "Latex Research Note",
          fileName: "distillation-note.tex",
          mediaType: "text/x-tex",
          contentBase64: base64Text([
            "\\title{Convergent Knowledge Distillation}",
            "\\author{Pact Runtime}",
            "\\section{Routing Model}",
            "The route-first parser keeps unrelated documents separated before synthesis.",
            "\\subsection{Evaluation}",
            "The objective score is $S = precision + recall$ and citations use \\cite{graphrag2024}.",
            "\\begin{itemize}",
            "\\item Parser traces must remain machine-readable.",
            "\\item Markup formulas must not be flattened before distillation.",
            "\\end{itemize}"
          ].join("\n"))
        },
        {
          sourceId: "source-40",
          title: "OpenDocument Distillation Plan",
          fileName: "distillation-plan.odt",
          mediaType: "application/vnd.oasis.opendocument.text",
          contentBase64: sampleOpenDocumentBase64
        },
        {
          sourceId: "source-41",
          title: "EPUB Distillation Evidence",
          fileName: "distillation-evidence.epub",
          mediaType: "application/epub+zip",
          contentBase64: sampleEpubBase64
        },
        {
          sourceId: "source-8",
          title: "DOCX Payload",
          fileName: "payload.docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          contentBase64: sampleDocxBase64
        },
        {
          sourceId: "source-9",
          title: "Workspace Package",
          fileName: "workspace.zip",
          mediaType: "application/zip",
          contentBase64: sampleZipBase64
        },
        {
          sourceId: "source-15",
          title: "Email With Attachment",
          fileName: "attachment-email.eml",
          mediaType: "message/rfc822",
          contentBase64: multipartEmailBase64({
            attachmentName: "invoice-attachment.csv",
            attachmentMediaType: "text/csv",
            attachmentText: "vendor,total,tax\nEmailCo,88,4"
          })
        },
        {
          sourceId: "source-26",
          title: "MBOX Mailbox",
          fileName: "mailbox.mbox",
          mediaType: "application/mbox",
          contentBase64: mboxBase64()
        },
        ...(directRuntime.payload.runtimes["tika.app"]?.available
          ? [{
              sourceId: "source-27",
              title: "Outlook MSG Payload",
              fileName: "outlook-message.msg",
              mediaType: "application/vnd.ms-outlook",
              contentBase64: msgTextBase64("Outlook MSG Tika parser extracts escalation schedule evidence.")
            }]
          : []),
        {
          sourceId: "source-16",
          title: "TAR Workspace Package",
          fileName: "workspace.tar",
          mediaType: "application/x-tar",
          contentBase64: base64Tar({
            "tar/architecture.md": "# TAR Architecture\nTAR child routing must preserve project evidence.",
            "tar/invoice.csv": "vendor,total\nTarCo,64"
          })
        },
        {
          sourceId: "source-17",
          title: "TGZ Workspace Package",
          fileName: "workspace.tgz",
          mediaType: "application/gzip",
          contentBase64: base64Tgz({
            "tgz/decision.md": "# TGZ Decision\nGzip tar payloads must decompress before child routing.",
            "tgz/metrics.json": JSON.stringify({ archive: "tgz", routed: true })
          })
        },
        ...(fileRefDocument ? [fileRefDocument] : []),
        ...(deferredFileRefDocument ? [deferredFileRefDocument] : []),
        ...(binaryProfileFileRefDocument ? [binaryProfileFileRefDocument] : []),
        ...(largeJsonFileRefDocument ? [largeJsonFileRefDocument] : []),
        ...(mountedDirectoryDocument ? [mountedDirectoryDocument] : []),
        ...(mountedArchiveDocument ? [mountedArchiveDocument] : []),
        ...mountedStructuredDocuments,
        ...(directRuntime.payload.runtimes["tika.app"]?.available ? mountedLegacyOfficeDocuments : []),
        {
          sourceId: "source-12",
          title: "PDF Payload",
          fileName: "payload.pdf",
          mediaType: "application/pdf",
          contentBase64: samplePdfBase64
        },
        {
          sourceId: "source-13",
          title: "PPTX Payload",
          fileName: "payload.pptx",
          mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          contentBase64: samplePptxBase64
        },
        {
          sourceId: "source-75",
          title: "Visio Architecture Flow",
          fileName: "architecture-flow.vsdx",
          mediaType: "application/vnd.ms-visio.drawing.main+xml",
          contentBase64: sampleVisioBase64
        },
        {
          sourceId: "source-14",
          title: "XLSX Payload",
          fileName: "payload.xlsx",
          mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBase64: sampleXlsxBase64
        },
        {
          sourceId: "source-44",
          title: "Signature Routed PDF",
          fileName: "signature-routed-pdf.asset",
          mediaType: "application/octet-stream",
          contentBase64: samplePdfBase64
        },
        {
          sourceId: "source-45",
          title: "Signature Routed DOCX",
          fileName: "signature-routed-docx.asset",
          mediaType: "application/octet-stream",
          contentBase64: sampleDocxBase64
        },
        {
          sourceId: "source-46",
          title: "Signature Routed PPTX",
          fileName: "signature-routed-pptx.asset",
          mediaType: "application/octet-stream",
          contentBase64: samplePptxBase64
        },
        {
          sourceId: "source-47",
          title: "Signature Routed XLSX",
          fileName: "signature-routed-xlsx.asset",
          mediaType: "application/octet-stream",
          contentBase64: sampleXlsxBase64
        },
        {
          sourceId: "source-76",
          title: "Signature Routed VSDX",
          fileName: "signature-routed-visio.asset",
          mediaType: "application/octet-stream",
          contentBase64: sampleVisioBase64
        },
        {
          sourceId: "source-48",
          title: "DOCM Payload",
          fileName: "payload.docm",
          mediaType: "application/vnd.ms-word.document.macroEnabled.12",
          contentBase64: sampleDocxBase64
        },
        {
          sourceId: "source-49",
          title: "PPTM Payload",
          fileName: "payload.pptm",
          mediaType: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
          contentBase64: samplePptxBase64
        },
        {
          sourceId: "source-50",
          title: "XLSM Payload",
          fileName: "payload.xlsm",
          mediaType: "application/vnd.ms-excel.sheet.macroEnabled.12",
          contentBase64: sampleXlsxBase64
        },
        {
          sourceId: "source-10",
          title: "Supplier Settlement",
          fileName: "settlement.txt",
          mediaType: "text/plain",
          text: "Supplier remittance calendar includes VAT amounts and settlement totals."
        },
        {
          sourceId: "source-11",
          title: "Noise",
          fileName: "noise.txt",
          mediaType: "text/plain",
          text: "ok"
        }
      ],
      requestedClaims: [
        "External service APIs must use the external.knowledge.distillation namespace.",
        "Submarine coffee roasting is guaranteed by the uploaded documents."
      ],
      maxWindowCharacters: 6000,
      windowOverlapCharacters: 300,
      workflowScope: "project",
      responseProfile: "agent"
    })
  });
  assert.equal(createRun.status, 201);
  assert.equal(createRun.payload.serviceName, "external-knowledge-distillation");
  assert.equal(createRun.payload.serviceKind, "externalKnowledgeDistillation");
  assert.equal(createRun.payload.status, "completed");
  assert.equal(createRun.payload.responseProfile, "agent");
  assert.equal(createRun.payload.workflowScope, "project");
  assert.equal(createRun.payload.scopeSelection.workflowScope, "project");
  assertExternalGatewayCall(createRun.payload, {
    serviceUrl,
    method: "POST",
    path: "/v1/distillation/runs",
    statusCode: 201,
    minRequestBytes: 100
  });
  assert.ok(createRun.payload.runId);
  assert.ok(
    createRun.payload.result.classification.groupCount >= 2,
    "unrelated source documents should be separated into classified distillation groups"
  );
  assert.equal(createRun.payload.result.algorithmVersion, "external-service.route-window-community-claim-gated-graph-incremental-distillation.v5");
  assert.equal(createRun.payload.result.workflowScope, "project");
  assert.equal(createRun.payload.result.agentMessage.workflowScope, "project");
  assert.equal(createRun.payload.result.incrementalPlan.strategy, "project-snapshot-incremental-convergence.v1");
  assert.equal(createRun.payload.result.incrementalPlan.snapshot.documents.length >= createRun.payload.result.corpusPlan.documents.length, true);
  assert.equal(createRun.payload.result.graphEvidence.strategy, "graph-lite-entity-relationship-evidence-pack.v1");
  assert.equal(createRun.payload.result.graphEvidence.summary.textUnitCount >= createRun.payload.result.corpusPlan.windowCount, true);
  assert.equal(createRun.payload.result.graphEvidence.summary.entityCount > 0, true);
  assert.equal(createRun.payload.result.graphEvidence.summary.relationshipCount > 0, true);
  assert.equal(createRun.payload.result.graphEvidence.covariates.some((claim) => claim.covariate_type === "claim"), true);
  assert.equal(createRun.payload.result.referenceGapReport.strategy, "reference-framework-gap-report.v1");
  assert.equal(createRun.payload.result.referenceGapReport.frameworks.some((framework) => framework.id === "graphrag" && framework.status === "absorbed-with-open-gaps"), true);
  assert.equal(createRun.payload.result.referenceGapReport.absorbedCapabilityMap.graphEvidence.evidence.includes("graph-lite-entity-relationship-evidence-pack.v1"), true);
  assert.equal(createRun.payload.result.classification.strategy, "hashing_embedding_window_community_classification_v3");
  assert.equal(createRun.payload.result.classification.taxonomyStrategy, "semantic-concept-topic-hierarchy.v1");
  assert.equal(createRun.payload.result.classification.assignmentRationaleStrategy, "leader-clustering-semantic-concept-rationale.v1");
  assert.equal(createRun.payload.result.classification.embedding.dimensions, 128);
  assert.equal(createRun.payload.result.classification.referencePatterns.includes("graphrag.community-reports"), true);
  assert.equal(createRun.payload.result.classification.lowCouplingHighCohesion.enforced, true);
  assert.equal(createRun.payload.result.classification.communityCount >= createRun.payload.result.classification.coreGroupCount, true);
  assert.equal(createRun.payload.result.classification.garbageGroupCount >= 1, true);
  const financeGroup = createRun.payload.result.classification.groups.find((group) => (
    group.sourceIds.includes("source-2") && group.sourceIds.includes("source-10")
  ));
  assert.ok(financeGroup, "semantic embedding classification should group invoice and supplier remittance documents");
  assert.equal(financeGroup.kind, "topic");
  assert.equal(financeGroup.topicHierarchy.strategy, "semantic-concept-topic-hierarchy.v1");
  assert.equal(financeGroup.topicHierarchy.primaryConcept, "finance");
  assert.equal(financeGroup.assignmentRationale.strategy, "leader-clustering-semantic-concept-rationale.v1");
  assert.equal(financeGroup.assignmentRationale.documents.some((document) => (
    document.sourceId === "source-2" &&
    ["new-topic", "nearest-leader"].includes(document.decision) &&
    typeof document.reason === "string" &&
    document.reason.length > 0
  )), true);
  assert.equal(financeGroup.windowCommunities.length >= 1, true);
  assert.equal(financeGroup.distillationUnit.mode, "topic-isolated");
  assert.equal(financeGroup.distillationUnit.topicPath.includes("finance"), true);
  assert.equal(financeGroup.distillationUnit.sourceIds.includes("source-2"), true);
  assert.equal(financeGroup.distillationUnit.windowRefs.length >= 1, true);
  assert.equal(typeof financeGroup.separationScore, "number");
  assert.equal(financeGroup.boundary, "isolated");
  assert.equal(createRun.payload.result.candidates.some((candidate) => (
    candidate.sourceIds.includes("source-2") &&
    candidate.distillationUnitId &&
    candidate.windowCommunityIds.length >= 1 &&
    candidate.promotionGate.promoted === true &&
    typeof candidate.separationScore === "number"
  )), true);
  const garbageGroup = createRun.payload.result.classification.groups.find((group) => group.sourceIds.includes("source-11"));
  assert.equal(garbageGroup?.kind, "garbage");
  assert.equal(garbageGroup?.excludedFromCore, true);
  assert.equal(garbageGroup?.topicHierarchy?.path?.includes("weak-evidence"), true);
  assert.equal(garbageGroup?.assignmentRationale?.documents?.some((document) => (
    document.sourceId === "source-11" &&
    document.decision === "weak-evidence" &&
    /below garbage threshold/.test(document.reason)
  )), true);
  assert.equal(garbageGroup?.exclusionReasons?.some((reason) => reason.code === "WEAK_EVIDENCE_SIGNAL"), true);
  assert.equal(createRun.payload.result.agentMessage.responseProfile, "agent");

  const documentScopedRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "单文档工作流枚举选择验证",
      title: "单文档工作流枚举选择验证",
      workflowScope: "document",
      sourceId: "doc-target",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "doc-skip",
          title: "Skipped Corpus Note",
          fileName: "skip.md",
          mediaType: "text/markdown",
          text: "This source must stay out of the single-document distillation scope."
        },
        {
          sourceId: "doc-target",
          title: "Target Document",
          fileName: "target.md",
          mediaType: "text/markdown",
          text: "The target document is the only source selected by workflowScope=document and sourceId=doc-target."
        }
      ]
    })
  });
  assert.equal(documentScopedRun.status, 201);
  assert.equal(documentScopedRun.payload.workflowScope, "document");
  assert.equal(documentScopedRun.payload.scopeSelection.strategy, "document-workflow-single-source-selection.v1");
  assert.deepEqual(documentScopedRun.payload.scopeSelection.selectedSourceIds, ["doc-target"]);
  assert.equal(documentScopedRun.payload.inputSummary.sourceCount, 2);
  assert.equal(documentScopedRun.payload.inputSummary.distillableSourceCount, 1);
  assert.deepEqual(documentScopedRun.payload.result.corpusPlan.documents.map((document) => document.sourceId), ["doc-target"]);
  assert.deepEqual(documentScopedRun.payload.result.routePlan.documents.map((document) => document.sourceId), ["doc-target"]);
  assert.equal(documentScopedRun.payload.result.agentMessage.workflowScope, "document");

  const missingDocumentScopeRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "单文档选择器缺失验证",
      title: "单文档选择器缺失验证",
      workflowScope: "document",
      sourceId: "missing-doc",
      rawDocuments: [
        {
          sourceId: "present-doc",
          title: "Present Document",
          fileName: "present.md",
          mediaType: "text/markdown",
          text: "The selector must not silently fall back to this document."
        }
      ]
    })
  });
  assert.equal(missingDocumentScopeRun.status, 400);
  assert.match(missingDocumentScopeRun.payload.error, /selector did not match any active document/);
  assert.equal(missingDocumentScopeRun.payload.pactExternalServiceCall.statusCode, 400);

  const invalidScopeRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "非法工作流枚举验证",
      title: "非法工作流枚举验证",
      workflowScope: "workspace",
      rawDocuments: [
        {
          sourceId: "invalid-scope",
          title: "Invalid Scope",
          fileName: "invalid.md",
          mediaType: "text/markdown",
          text: "This request must fail before distillation because workflowScope is not a supported enum value."
        }
      ]
    })
  });
  assert.equal(invalidScopeRun.status, 400);
  assert.match(invalidScopeRun.payload.error, /Invalid workflowScope enum value/);
  assert.equal(invalidScopeRun.payload.pactExternalServiceCall.statusCode, 400);

  assert.equal(createRun.payload.result.routePlan.strategy, "content-signature-extension-media-shape-routing.v2");
  assert.equal(createRun.payload.result.routePlan.routeOrder[0], "contentSignature");
  assert.equal(createRun.payload.result.corpusPlan.allSizePolicy, "streaming-windowed");
  if (rawDocumentsManifestPath) {
    assert.equal(createRun.payload.result.corpusPlan.inputDocumentPlan.strategy, "inline-or-streaming-manifest-document-input.v1");
    assert.equal(createRun.payload.result.corpusPlan.inputDocumentPlan.manifestDocumentCount, 2);
    assert.equal(createRun.payload.result.corpusPlan.inputDocumentPlan.manifests[0].format, "jsonl");
    assert.equal(createRun.payload.result.agentMessage.corpusPlan.inputDocumentPlan.manifestDocumentCount, 2);
  }
  assert.equal(createRun.payload.result.convergence.strategy, "hierarchical-domain-topic-project-convergence.v3");
  assert.equal(createRun.payload.result.convergence.layers.includes("project-domain"), true);
  assert.equal(createRun.payload.result.convergence.agentQueryIndex.strategy, "agent-project-convergence-query-index.v1");
  assert.equal(createRun.payload.result.convergence.domainReports.some((domain) => (
    domain.domainKey === "docs" &&
    domain.sourceIds.includes("source-9!docs/architecture.md")
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-9!docs/architecture.md" &&
    unit.metadata?.projectDomain === "docs"
  )), true);
  assert.equal(createRun.payload.result.convergence.layers.includes("window-community"), true);
  assert.equal(createRun.payload.result.convergence.communityReports.length >= 1, true);
  assert.equal(createRun.payload.result.convergence.projectSynthesis.mode, "multi-topic-separated");
  const routedPdf = createRun.payload.result.routePlan.documents.find((document) => document.sourceId === "source-3");
  assert.ok(routedPdf, "large PDF source must be present in route plan");
  assert.equal(routedPdf.formatId, "pdf");
  assert.equal(routedPdf.pdfSubtype, "pdf-text");
  assert.equal(routedPdf.pdfSubtypeStrategy, "pdf-subtype-routing.v1");
  assert.equal(routedPdf.parserChain.includes("ocr.page"), true);
  assert.equal(routedPdf.riskFlags.includes("large-file-risk"), true);
  const routedSpreadsheet = createRun.payload.result.routePlan.documents.find((document) => document.sourceId === "source-2");
  assert.equal(routedSpreadsheet?.formatId, "spreadsheet");
  if (rawDocumentsManifestPath) {
    const manifestMarkdownCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "manifest-md");
    assert.ok(manifestMarkdownCorpus, "JSONL manifest markdown document must enter corpus plan");
    assert.equal(manifestMarkdownCorpus.sourceKind, "manifest-entry");
    assert.equal(manifestMarkdownCorpus.manifestLine, 1);
    assert.equal(manifestMarkdownCorpus.parseStatus, "completed");
    assert.equal(manifestMarkdownCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref"), true);
    const manifestCsvCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "manifest-csv");
    assert.ok(manifestCsvCorpus, "JSONL manifest CSV document must enter corpus plan");
    assert.equal(manifestCsvCorpus.route.formatId, "spreadsheet");
    assert.equal(manifestCsvCorpus.parserTrace.some((trace) => trace.stage === "table.csv"), true);
  }
  const routedImage = createRun.payload.result.routePlan.documents.find((document) => document.sourceId === "source-4");
  assert.equal(routedImage?.riskFlags.includes("ocr-required"), true);
  const largePdfCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-3");
  assert.ok(largePdfCorpus.windowPlan.windowCount > 1, "large PDF text must be split into multiple windows");
  assert.equal(largePdfCorpus.windowPlan.maxCharacters, 6000);
  const markdownPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-5");
  assert.equal(markdownPayloadCorpus.parseStatus, "completed");
  assert.equal(markdownPayloadCorpus.quality.evidenceStrength, "parsed-payload");
  assert.equal(markdownPayloadCorpus.parserTrace.some((trace) => trace.stage === "text.markdown"), true);
  assert.equal(markdownPayloadCorpus.parserTrace.some((trace) => trace.stage === "markdown.frontmatter" && trace.status === "completed" && trace.fields >= 3 && trace.frontmatter >= 3), true);
  assert.equal(markdownPayloadCorpus.parserTrace.some((trace) => trace.stage === "markdown.structure" && trace.status === "completed" && trace.headings >= 1 && trace.tables >= 2 && trace.codeBlocks >= 1 && trace.blockquotes >= 1 && trace.links >= 1 && trace.images >= 1 && trace.metadata >= 3), true);
  assert.equal(markdownPayloadCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(markdownPayloadCorpus.elementPlan.sourceFormat, "markdown");
  assert.equal(markdownPayloadCorpus.elementPlan.elementTypes.heading >= 1, true);
  assert.equal(markdownPayloadCorpus.elementPlan.elementTypes.frontmatter >= 3, true);
  assert.equal(markdownPayloadCorpus.elementPlan.elementTypes["table-row"] >= 1, true);
  assert.equal(markdownPayloadCorpus.elementPlan.elementTypes.code >= 1, true);
  assert.equal(markdownPayloadCorpus.elementPlan.elementTypes.blockquote >= 1, true);
  assert.equal(markdownPayloadCorpus.elementPlan.elementTypes.link >= 1, true);
  assert.equal(markdownPayloadCorpus.elementPlan.elementTypes.image >= 1, true);
  assert.equal(markdownPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "frontmatter" &&
    element.frontmatter?.key === "owner" &&
    element.frontmatter?.value === "platform"
  )), true);
  assert.equal(markdownPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "frontmatter" &&
    element.frontmatter?.key === "tags" &&
    Array.isArray(element.frontmatter?.value) &&
    element.frontmatter.value.includes("agent")
  )), true);
  assert.equal(markdownPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "code" &&
    element.codeBlock?.kind === "markdown-code-fence" &&
    element.codeBlock?.language === "ts" &&
    element.codeBlock?.lineStart >= 1 &&
    /const profile/.test(element.text)
  )), true);
  assert.equal(markdownPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "blockquote" &&
    element.quote?.kind === "markdown-blockquote" &&
    element.quote?.depth === 1 &&
    /quoted operational warnings/.test(element.text)
  )), true);
  assert.equal(markdownPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "frontmatter" &&
    ref.frontmatter?.key === "owner" &&
    ref.frontmatter?.value === "platform"
  ))), true);
  assert.equal(markdownPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.href === "https://example.test/agent"
  ))), true);
  assert.equal(markdownPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "image" &&
    ref.href === "https://example.test/architecture.png"
  ))), true);
  assert.equal(markdownPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "code" &&
    ref.codeBlock?.language === "ts"
  ))), true);
  assert.equal(markdownPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "blockquote" &&
    ref.quote?.depth === 1
  ))), true);
  assert.equal(markdownPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-5" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "frontmatter" &&
      ref.frontmatter?.key === "owner" &&
      ref.frontmatter?.value === "platform"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-5" &&
    unit.metadata?.elementRefs?.some((ref) => ref.type === "code" && ref.codeBlock?.language === "ts")
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-5" &&
    unit.metadata?.elementRefs?.some((ref) => ref.type === "blockquote" && ref.quote?.depth === 1)
  )), true);
  assert.equal(markdownPayloadCorpus.formatConversionProfile.parserProfile, "markdown-block-element-route");
  assert.equal(markdownPayloadCorpus.formatConversionProfile.conversionTargets.includes("valid-openxml-docx"), true);
  assert.equal(markdownPayloadCorpus.formatConversionProfile.preserves.includes("frontmatter"), true);
  assert.equal(markdownPayloadCorpus.formatConversionProfile.preserves.includes("codeBlocks"), true);
  assert.equal(markdownPayloadCorpus.formatConversionProfile.preserves.includes("blockquotes"), true);
  const professionalConversionPlan = createRun.payload.result.formatConversionPlan;
  assert.equal(professionalConversionPlan.strategy, "office-document-professional-adaptation.v1");
  assert.equal(professionalConversionPlan.summary.targetFormats.includes("docx"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("docx-openxml-package-valid"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("word-link-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("word-content-control-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("word-bookmark-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("word-revision-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("pdf-outline-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("pdf-form-fields-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("markdown-link-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("markdown-image-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("markdown-frontmatter-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("markdown-code-blocks-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("markdown-blockquote-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.qualityGates.includes("spreadsheet-defined-name-refs-preserved"), true);
  assert.equal(professionalConversionPlan.summary.documentWithPdfOutlineRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithPdfFormFieldRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithFrontmatterRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithCodeBlockRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithBlockquoteRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithContentControlRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithBookmarkRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithDefinedNameRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithNamedRangeRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithPrintAreaRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.documentWithRevisionRefsCount >= 1, true);
  assert.equal(professionalConversionPlan.summary.qualityGateStatusCounts.passed > 0, true);
  assert.equal(professionalConversionPlan.summary.outputArtifactValidationStrategy, "format-conversion-output-artifact-self-check.v1");
  assert.equal(professionalConversionPlan.summary.outputArtifactFailedCount, 0);
  assert.equal(professionalConversionPlan.outputArtifactValidation.artifacts.some((artifact) => (
    artifact.artifactId === "portable-docx" &&
    artifact.status === "passed" &&
    artifact.gates.some((gate) => gate.gate === "openxml-required-parts-present" && gate.status === "passed")
  )), true);
  for (const [sourceId, routeId, family, qualityGate] of [
    ["source-5", "markdown", "markdown", "heading-tree-preserved"],
    ["source-8", "word", "office-word", "word-annotation-refs-preserved"],
    ["source-12", "pdf", "pdf", "page-order-preserved"],
    ["source-13", "presentation", "office-presentation", "slide-order-preserved"],
    ["source-14", "spreadsheet", "office-spreadsheet", "formula-text-preserved"]
  ]) {
    const document = professionalConversionPlan.documents.find((item) => item.sourceId === sourceId);
    assert.ok(document, `${sourceId} must be present in professional conversion plan`);
    assert.equal(document.routeId, routeId);
    assert.equal(document.professionalFamily, family);
    assert.equal(document.conversionAdapters.some((adapter) => adapter.targetFormat === "docx"), true);
    assert.equal(document.conversionAdapters.some((adapter) => adapter.targetFormat === "agent-json"), true);
    assert.equal(document.qualityGates.includes(qualityGate), true);
    assert.equal(document.qualityGateResults.some((gate) => gate.gate === qualityGate && gate.status === "passed"), true);
    assert.equal(["low", "medium"].includes(document.conversionRiskLevel), true);
    assert.equal(document.openability.docxOpenXmlPackage, true);
  }
  assert.equal(professionalConversionPlan.documents.some((document) => (
    document.sourceId === "source-5" &&
    document.parserProfile === "markdown-block-element-route" &&
    document.conversionTargets.includes("valid-openxml-docx") &&
    document.parserStages.includes("markdown.frontmatter") &&
    document.preserves.includes("frontmatter") &&
    document.preserves.includes("codeBlocks") &&
    document.preserves.includes("blockquotes") &&
    document.evidence.frontmatterRefCount >= 3 &&
    document.evidence.codeBlockRefCount >= 1 &&
    document.evidence.blockquoteRefCount >= 1 &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.imageRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-frontmatter-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-code-blocks-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-blockquote-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-image-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalConversionPlan.documents.some((document) => (
    document.sourceId === "source-8" &&
    document.routeId === "word" &&
    document.evidence.styleRefCount >= 1 &&
    document.evidence.numberingRefCount >= 1 &&
    document.evidence.contentControlRefCount >= 1 &&
    document.evidence.bookmarkRefCount >= 1 &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.imageRefCount >= 1 &&
    document.evidence.revisionRefCount >= 2 &&
    document.qualityGateResults.some((gate) => gate.gate === "word-paragraph-style-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-list-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-content-control-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-bookmark-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-revision-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalConversionPlan.documents.some((document) => (
    document.sourceId === "source-12" &&
    document.routeId === "pdf" &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.pdfOutlineRefCount >= 2 &&
    document.evidence.pdfFormFieldRefCount >= 1 &&
    document.qualityGates.includes("pdf-link-refs-preserved") &&
    document.qualityGates.includes("pdf-outline-refs-preserved") &&
    document.qualityGates.includes("pdf-form-fields-preserved") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-outline-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-form-fields-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalConversionPlan.documents.some((document) => (
    document.sourceId === "source-14" &&
    document.routeId === "spreadsheet" &&
    document.evidence.definedNameRefCount >= 2 &&
    document.evidence.namedRangeRefCount >= 1 &&
    document.evidence.printAreaRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-defined-name-refs-preserved" && gate.status === "passed")
  )), true);
  const jsonPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-6");
  assert.equal(jsonPayloadCorpus.parserTrace.some((trace) => trace.stage === "structured.json"), true);
  const csvPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-7");
  assert.equal(csvPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.csv"), true);
  assert.equal(csvPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.time-index" && trace.status === "completed" && trace.from === "2026-05-31" && trace.to === "2026-06-30"), true);
  assert.equal(csvPayloadCorpus.timeRange.from, "2026-05-31");
  assert.equal(csvPayloadCorpus.timeRange.to, "2026-06-30");
  assert.equal(csvPayloadCorpus.windowPlan.windows.some((window) => window.timeRange?.from === "2026-05-31"), true);
  const configPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-28");
  assert.equal(configPayloadCorpus.route.formatId, "config");
  assert.equal(configPayloadCorpus.parserTrace.some((trace) => trace.stage === "config.key-value" && trace.status === "completed" && trace.entries >= 4), true);
  assert.match(configPayloadCorpus.windowPlan.windows[0]?.excerpt || "", /service\.name|parser\.strategy/);
  const diagramPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-29");
  assert.equal(diagramPayloadCorpus.route.formatId, "diagram");
  assert.equal(diagramPayloadCorpus.parserTrace.some((trace) => trace.stage === "diagram.structure" && trace.status === "completed" && trace.nodes >= 3 && trace.edges >= 2), true);
  assert.match(diagramPayloadCorpus.windowPlan.windows[0]?.excerpt || "", /External API|Agent Message|Graph Evidence Pack/);
  const notebookPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-34");
  assert.equal(notebookPayloadCorpus.route.formatId, "notebook");
  assert.equal(notebookPayloadCorpus.parserTrace.some((trace) => trace.stage === "notebook.cells" && trace.status === "completed" && trace.cells === 2 && trace.markdownCells === 1 && trace.codeCells === 1 && trace.outputs === 1), true);
  assert.match(notebookPayloadCorpus.windowPlan.windows[0]?.excerpt || "", /Distillation Experiment|experiment accuracy/);
  const sourcePayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-35");
  assert.equal(sourcePayloadCorpus.route.formatId, "source-code");
  assert.equal(sourcePayloadCorpus.parserTrace.some((trace) => trace.stage === "code.structure" && trace.status === "completed" && trace.language === "typescript" && trace.imports >= 2 && trace.symbols >= 3 && trace.entryPoints >= 1 && trace.todos >= 1), true);
  assert.match(sourcePayloadCorpus.windowPlan.windows[0]?.excerpt || "", /DistillationRuntime|routeSource|startServer/);
  const diffPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-36");
  assert.equal(diffPayloadCorpus.route.formatId, "diff");
  assert.equal(diffPayloadCorpus.parserTrace.some((trace) => trace.stage === "diff.unified" && trace.status === "completed" && trace.files === 1 && trace.hunks === 1 && trace.additions === 4 && trace.deletions === 1), true);
  assert.match(diffPayloadCorpus.windowPlan.windows[0]?.excerpt || "", /src\/runtime\.ts|routeByFormat|diff\.unified/);
  const calendarPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-37");
  assert.equal(calendarPayloadCorpus.route.formatId, "calendar");
  assert.equal(calendarPayloadCorpus.parserTrace.some((trace) => trace.stage === "calendar.ics" && trace.status === "completed" && trace.events === 1 && trace.todos === 1 && trace.from === "2026-06-15" && trace.to === "2026-06-16"), true);
  assert.equal(calendarPayloadCorpus.timeRange.from, "2026-06-15");
  assert.equal(calendarPayloadCorpus.timeRange.to, "2026-06-16");
  assert.match(calendarPayloadCorpus.windowPlan.windows[0]?.excerpt || "", /Knowledge distillation release review|Ship calendar parser verification/);
  const transcriptCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-71");
  assert.equal(transcriptCorpus.route.formatId, "transcript");
  assert.equal(transcriptCorpus.parserTrace.some((trace) => trace.stage === "transcript.cues" && trace.status === "completed" && trace.cues === 2 && trace.speakers === 2), true);
  assert.equal(transcriptCorpus.parserTrace.some((trace) => trace.stage === "transcript.webvtt" && trace.status === "completed"), true);
  assert.equal(transcriptCorpus.elementPlan.elementTypes["transcript-cue"] >= 2, true);
  assert.equal(transcriptCorpus.elementPlan.elementTypes["speaker-turn"] >= 2, true);
  assert.equal(transcriptCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => ref.transcript?.speaker === "Architect")), true);
  assert.match(transcriptCorpus.windowPlan.windows[0]?.excerpt || "", /cue-level evidence|Finance XBRL facts/);
  const xbrlCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-72");
  assert.equal(xbrlCorpus.route.formatId, "financial-report");
  assert.equal(xbrlCorpus.parserTrace.some((trace) => trace.stage === "xbrl.contexts" && trace.status === "completed" && trace.contexts === 1), true);
  assert.equal(xbrlCorpus.parserTrace.some((trace) => trace.stage === "xbrl.facts" && trace.status === "completed" && trace.facts >= 2 && trace.units === 1), true);
  assert.equal(xbrlCorpus.elementPlan.elementTypes["xbrl-fact"] >= 2, true);
  assert.equal(xbrlCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => ref.xbrlFact?.contextRef === "FY2026Q2")), true);
  assert.match(xbrlCorpus.windowPlan.windows[0]?.excerpt || "", /Revenue|OperatingIncomeLoss|4200000/);
  const audioCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-73");
  assert.equal(audioCorpus.route.formatId, "audio");
  assert.equal(audioCorpus.parseStatus, "empty");
  assert.equal(audioCorpus.parserTrace.some((trace) => trace.stage === "audio.metadata" && trace.status === "completed"), true);
  assert.equal(audioCorpus.parserTrace.some((trace) => trace.stage === "audio.transcript-sidecar" && trace.status === "requires-input"), true);
  const htmlMarkupCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-38");
  assert.equal(htmlMarkupCorpus.route.formatId, "markup");
  assert.equal(htmlMarkupCorpus.parserTrace.some((trace) => trace.stage === "markup.structure" && trace.status === "completed" && trace.format === "html" && trace.elements >= 8 && trace.headings >= 2 && trace.links >= 1 && trace.tables >= 2 && trace.codeBlocks >= 1), true);
  assert.equal(htmlMarkupCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(htmlMarkupCorpus.elementPlan.elementTypes.heading >= 2, true);
  assert.equal(htmlMarkupCorpus.elementPlan.elementTypes.link >= 1, true);
  assert.equal(htmlMarkupCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(htmlMarkupCorpus.windowPlan.source.kind, "structure-elements");
  assert.equal(htmlMarkupCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => ref.type === "table-row")), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-38" &&
    unit.metadata?.semanticChunkStrategy === "unstructured.by-title-element-windowing.v1" &&
    unit.metadata?.elementTypes?.includes("table-row")
  )), true);
  assert.equal(htmlMarkupCorpus.windowPlan.windows.some((window) => (
    /External knowledge distillation operations|markup\.structure|agent contract/.test(window.excerpt || "")
  )), true);
  const latexMarkupCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-39");
  assert.equal(latexMarkupCorpus.route.formatId, "markup");
  assert.equal(latexMarkupCorpus.parserTrace.some((trace) => trace.stage === "markup.structure" && trace.status === "completed" && trace.format === "latex" && trace.headings >= 3 && trace.listItems >= 2 && trace.formulas >= 1), true);
  assert.equal(latexMarkupCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(latexMarkupCorpus.elementPlan.elementTypes.formula >= 1, true);
  assert.equal(latexMarkupCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(latexMarkupCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => ref.type === "formula")), true);
  assert.equal(latexMarkupCorpus.windowPlan.windows.some((window) => (
    /Convergent Knowledge Distillation|Routing Model|precision/.test(window.excerpt || "")
  )), true);
  const openDocumentPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-40");
  assert.equal(openDocumentPayloadCorpus.route.formatId, "open-document");
  assert.equal(openDocumentPayloadCorpus.parserTrace.some((trace) => trace.stage === "open-document.structured" && trace.status === "completed" && trace.elements >= 4 && trace.headings >= 1 && trace.paragraphs >= 1 && trace.tableRows >= 2), true);
  assert.equal(openDocumentPayloadCorpus.parserTrace.some((trace) => trace.stage === "open-document.tables" && trace.status === "completed" && trace.tables === 1 && trace.cells === 6), true);
  assert.equal(openDocumentPayloadCorpus.parserTrace.some((trace) => trace.stage === "open-document.hyperlinks" && trace.status === "completed" && trace.links === 1), true);
  assert.equal(openDocumentPayloadCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(openDocumentPayloadCorpus.elementPlan.sourceFormat, "open-document");
  assert.equal(openDocumentPayloadCorpus.elementPlan.elementTypes.heading >= 1, true);
  assert.equal(openDocumentPayloadCorpus.elementPlan.elementTypes.paragraph >= 1, true);
  assert.equal(openDocumentPayloadCorpus.elementPlan.elementTypes.link >= 1, true);
  assert.equal(openDocumentPayloadCorpus.elementPlan.elementTypes["table-header"] >= 1, true);
  assert.equal(openDocumentPayloadCorpus.elementPlan.elementTypes["table-row"] >= 1, true);
  assert.equal(openDocumentPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "table-row" &&
    element.table?.format === "open-document" &&
    element.cells?.some((cell) => cell.ref === "B2" && cell.header === "Decision" && cell.value.includes("OpenDocument cells"))
  )), true);
  assert.equal(openDocumentPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "link" &&
    element.href === "https://example.com/odf-evidence" &&
    element.text.includes("OpenDocument evidence portal")
  )), true);
  assert.equal(openDocumentPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(openDocumentPayloadCorpus.windowPlan.windows.some((window) => /OpenDocument Distillation Plan|project convergence evidence/.test(window.excerpt || "")), true);
  assert.equal(openDocumentPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-row" &&
    ref.table?.format === "open-document" &&
    ref.cells?.some((cell) => cell.ref === "B2")
  ))), true);
  assert.equal(openDocumentPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.href === "https://example.com/odf-evidence"
  ))), true);
  assert.equal(openDocumentPayloadCorpus.formatConversionProfile.preserves.includes("cellRefs"), true);
  assert.equal(openDocumentPayloadCorpus.formatConversionProfile.preserves.includes("links"), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-40" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "table-row" &&
      ref.table?.format === "open-document" &&
      ref.cells?.some((cell) => cell.ref === "B2")
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-40" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "link" &&
      ref.href === "https://example.com/odf-evidence"
    ))
  )), true);
  const epubPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-41");
  assert.equal(epubPayloadCorpus.route.formatId, "ebook");
  assert.equal(epubPayloadCorpus.parserTrace.some((trace) => trace.stage === "ebook.epub" && trace.status === "completed" && trace.elements >= 2 && trace.chapters >= 1 && trace.headings >= 1 && trace.paragraphs >= 1), true);
  assert.equal(epubPayloadCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(epubPayloadCorpus.elementPlan.sourceFormat, "epub");
  assert.equal(epubPayloadCorpus.elementPlan.elementTypes.heading >= 1, true);
  assert.equal(epubPayloadCorpus.elementPlan.elementTypes.paragraph >= 1, true);
  assert.equal(epubPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(epubPayloadCorpus.windowPlan.windows.some((window) => /EPUB Distillation Evidence|agent element windows/.test(window.excerpt || "")), true);
  const docxPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-8");
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => trace.stage === "office.word.structured" && trace.status === "completed"), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => trace.stage === "office.word.styles" && trace.status === "completed" && trace.styles >= 3 && trace.headings >= 2), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => trace.stage === "office.word.numbering" && trace.status === "completed" && trace.numberingRefs === 1), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => trace.stage === "office.word.tables" && trace.status === "completed" && trace.tables === 1 && trace.cells === 6), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.word.headers-footers" &&
    trace.status === "completed" &&
    trace.headerParts === 1 &&
    trace.footerParts === 1 &&
    trace.headers >= 1 &&
    trace.footers >= 1
  )), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => trace.stage === "office.word.content-controls" && trace.status === "completed" && trace.contentControls === 1), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => trace.stage === "office.word.bookmarks" && trace.status === "completed" && trace.bookmarks === 1), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.word.annotations" &&
    trace.status === "completed" &&
    trace.comments === 1 &&
    trace.footnotes === 1 &&
    trace.endnotes === 1
  )), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.word.revisions" &&
    trace.status === "completed" &&
    trace.revisions === 2 &&
    trace.inserted === 1 &&
    trace.deleted === 1
  )), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.word.hyperlinks" &&
    trace.status === "completed" &&
    trace.links === 1
  )), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.word.images" &&
    trace.status === "completed" &&
    trace.images === 1
  )), true);
  assert.equal(docxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.word.charts" &&
    trace.status === "completed" &&
    trace.charts === 1 &&
    trace.chartSeries === 1
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(docxPayloadCorpus.elementPlan.sourceFormat, "docx");
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.title >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.heading >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes["list-item"] >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.paragraph >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes["table-header"] >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes["table-row"] >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.link >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.image >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.chart >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes["content-control"] >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.bookmark >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.header >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.footer >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.comment >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.revision >= 2, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.footnote >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.elementTypes.endnote >= 1, true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "heading" &&
    element.style?.styleId === "Heading1" &&
    element.text.includes("Routing Decisions")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "list-item" &&
    element.style?.styleId === "ListParagraph" &&
    element.style?.numberingId === "9" &&
    element.style?.numberingLevel === 0
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "table-row" &&
    element.table?.format === "docx" &&
    element.cells?.some((cell) => cell.ref === "B2" && cell.header === "Decision" && cell.value.includes("external.knowledge.distillation"))
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "content-control" &&
    element.control?.kind === "word-content-control" &&
    element.control?.alias === "Decision Owner" &&
    element.control?.tag === "decision.owner" &&
    element.control?.controlType === "text" &&
    element.text.includes("Platform Architecture")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "bookmark" &&
    element.bookmark?.kind === "word-bookmark" &&
    element.bookmark?.id === "42" &&
    element.bookmark?.name === "DecisionScope" &&
    element.text.includes("routing impact")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "header" &&
    element.headerFooter?.kind === "header" &&
    element.headerFooter?.partName === "word/header1.xml" &&
    element.text.includes("classification and routing evidence")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "footer" &&
    element.headerFooter?.kind === "footer" &&
    element.headerFooter?.partName === "word/footer1.xml" &&
    element.text.includes("approval timestamp")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "comment" &&
    element.annotation?.kind === "comment" &&
    element.annotation?.id === "7" &&
    element.annotation?.author === "Reviewer" &&
    element.text.includes("routing decision evidence")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "revision" &&
    element.annotation?.kind === "word-revision" &&
    element.annotation?.type === "insertion" &&
    element.annotation?.author === "Revision Author" &&
    element.text.includes("Inserted tracked-change evidence")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "revision" &&
    element.annotation?.kind === "word-revision" &&
    element.annotation?.type === "deletion" &&
    element.annotation?.author === "Revision Author" &&
    element.text.includes("Deleted tracked-change evidence")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "link" &&
    element.href === "https://example.com/docx-evidence" &&
    element.text.includes("DOCX evidence portal")
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "image" &&
    element.href === "word/media/architecture.png" &&
    element.image?.relationshipId === "rIdImage1" &&
    element.image?.target === "word/media/architecture.png" &&
    element.image?.description === "DOCX architecture diagram evidence"
  )), true);
  assert.equal(docxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "chart" &&
    element.href === "word/charts/chart1.xml" &&
    element.chart?.relationshipId === "rIdChart1" &&
    element.chart?.chartPart === "word/charts/chart1.xml" &&
    element.chart?.title === "DOCX Decision Trend" &&
    element.chart?.chartType === "barChart" &&
    element.chart?.series?.some((series) => series.name === "DOCX Evidence Count" && series.values.includes("84"))
  )), true);
  assert.equal(docxPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(docxPayloadCorpus.windowPlan.source.structureFormat, "docx");
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "list-item" &&
    ref.style?.styleId === "ListParagraph" &&
    ref.style?.numberingId === "9"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-row" &&
    ref.table?.format === "docx" &&
    ref.cells?.some((cell) => cell.ref === "B2")
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "content-control" &&
    ref.control?.tag === "decision.owner" &&
    ref.control?.alias === "Decision Owner"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "bookmark" &&
    ref.bookmark?.name === "DecisionScope"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "header" &&
    ref.headerFooter?.kind === "header" &&
    ref.headerFooter?.partName === "word/header1.xml"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "footer" &&
    ref.headerFooter?.kind === "footer" &&
    ref.headerFooter?.partName === "word/footer1.xml"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "comment" &&
    ref.annotation?.kind === "comment" &&
    ref.annotation?.id === "7"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "revision" &&
    ref.annotation?.kind === "word-revision" &&
    ref.annotation?.type === "insertion" &&
    ref.annotation?.author === "Revision Author"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "revision" &&
    ref.annotation?.kind === "word-revision" &&
    ref.annotation?.type === "deletion" &&
    ref.annotation?.author === "Revision Author"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.href === "https://example.com/docx-evidence"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "image" &&
    ref.href === "word/media/architecture.png" &&
    ref.image?.relationshipId === "rIdImage1"
  ))), true);
  assert.equal(docxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "chart" &&
    ref.href === "word/charts/chart1.xml" &&
    ref.chart?.relationshipId === "rIdChart1" &&
    ref.chart?.series?.some((series) => series.name === "DOCX Evidence Count")
  ))), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.parserProfile, "wordprocessingml-paragraph-style-route");
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("paragraphStyles"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("listLevels"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("cellRefs"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("links"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("images"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("charts"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("chartSeries"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("contentControls"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("bookmarks"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("headers"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("footers"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("comments"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("footnotes"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.preserves.includes("revisions"), true);
  assert.equal(docxPayloadCorpus.formatConversionProfile.conversionTargets.includes("valid-openxml-docx"), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "list-item" &&
      ref.style?.styleId === "ListParagraph" &&
      ref.style?.numberingId === "9"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "table-row" &&
      ref.table?.format === "docx" &&
      ref.cells?.some((cell) => cell.ref === "B2")
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "content-control" &&
      ref.control?.tag === "decision.owner" &&
      ref.control?.alias === "Decision Owner"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "bookmark" &&
      ref.bookmark?.name === "DecisionScope"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "header" &&
      ref.headerFooter?.kind === "header" &&
      ref.headerFooter?.partName === "word/header1.xml"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "footer" &&
      ref.headerFooter?.kind === "footer" &&
      ref.headerFooter?.partName === "word/footer1.xml"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "comment" &&
      ref.annotation?.kind === "comment" &&
      ref.annotation?.id === "7"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "revision" &&
      ref.annotation?.kind === "word-revision" &&
      ref.annotation?.author === "Revision Author"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "link" &&
      ref.href === "https://example.com/docx-evidence"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "image" &&
      ref.image?.target === "word/media/architecture.png" &&
      ref.image?.relationshipId === "rIdImage1"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-8" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "chart" &&
      ref.chart?.chartPart === "word/charts/chart1.xml" &&
      ref.chart?.series?.some((series) => series.name === "DOCX Evidence Count")
    ))
  )), true);
  const zipPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-9");
  assert.equal(zipPayloadCorpus.parserTrace.some((trace) => trace.stage === "archive.manifest" && trace.status === "completed"), true);
  assert.equal(zipPayloadCorpus.parserTrace.some((trace) => trace.stage === "archive.expand-route" && trace.status === "completed"), true);
  const zipMarkdownChildCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-9!docs/architecture.md");
  assert.ok(zipMarkdownChildCorpus, "archive Markdown child must be expanded into corpus");
  assert.equal(zipMarkdownChildCorpus.parentSourceId, "source-9");
  assert.equal(zipMarkdownChildCorpus.route.formatId, "markdown");
  assert.equal(zipMarkdownChildCorpus.parserTrace.some((trace) => trace.stage === "archive.entry" && trace.status === "expanded"), true);
  assert.equal(zipMarkdownChildCorpus.parserTrace.some((trace) => trace.stage === "text.markdown" && trace.status === "completed"), true);
  const zipCsvChildCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-9!data/invoice.csv");
  assert.ok(zipCsvChildCorpus, "archive CSV child must be expanded into corpus");
  assert.equal(zipCsvChildCorpus.parentSourceId, "source-9");
  assert.equal(zipCsvChildCorpus.route.formatId, "spreadsheet");
  assert.equal(zipCsvChildCorpus.parserTrace.some((trace) => trace.stage === "table.csv" && trace.status === "completed"), true);
  const emailPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-15");
  assert.ok(emailPayloadCorpus, "email parent must be present in corpus");
  assert.equal(emailPayloadCorpus.route.formatId, "email");
  assert.equal(emailPayloadCorpus.parserTrace.some((trace) => trace.stage === "email.headers-body" && trace.status === "completed"), true);
  assert.equal(emailPayloadCorpus.parserTrace.some((trace) => trace.stage === "email.attachment-route" && trace.status === "completed"), true);
  const emailAttachmentCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-15!attachment:invoice-attachment.csv");
  assert.ok(emailAttachmentCorpus, "email CSV attachment must be expanded into corpus");
  assert.equal(emailAttachmentCorpus.parentSourceId, "source-15");
  assert.equal(emailAttachmentCorpus.route.formatId, "spreadsheet");
  assert.equal(emailAttachmentCorpus.parserTrace.some((trace) => trace.stage === "email.attachment" && trace.status === "expanded"), true);
  assert.equal(emailAttachmentCorpus.parserTrace.some((trace) => trace.stage === "table.csv" && trace.status === "completed"), true);
  const mboxPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-26");
  assert.ok(mboxPayloadCorpus, "MBOX parent must be present in corpus");
  assert.equal(mboxPayloadCorpus.route.formatId, "email");
  assert.equal(mboxPayloadCorpus.parserTrace.some((trace) => trace.stage === "email.mbox" && trace.status === "completed" && trace.messages === 2), true);
  assert.equal(mboxPayloadCorpus.parserTrace.some((trace) => trace.stage === "email.mbox-route" && trace.status === "completed"), true);
  const mboxMessageCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-26!message:1");
  assert.ok(mboxMessageCorpus, "MBOX first message must be expanded into corpus");
  assert.equal(mboxMessageCorpus.parentSourceId, "source-26");
  assert.equal(mboxMessageCorpus.route.formatId, "email");
  assert.equal(mboxMessageCorpus.parserTrace.some((trace) => trace.stage === "email.mbox-message" && trace.status === "expanded"), true);
  assert.equal(mboxMessageCorpus.parserTrace.some((trace) => trace.stage === "email.headers-body" && trace.status === "completed"), true);
  const mboxAttachmentCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-26!message:2!attachment:mbox-invoice.csv");
  assert.ok(mboxAttachmentCorpus, "MBOX message CSV attachment must be expanded into corpus");
  assert.equal(mboxAttachmentCorpus.parentSourceId, "source-26!message:2");
  assert.equal(mboxAttachmentCorpus.route.formatId, "spreadsheet");
  assert.equal(mboxAttachmentCorpus.parserTrace.some((trace) => trace.stage === "email.attachment" && trace.status === "expanded"), true);
  assert.equal(mboxAttachmentCorpus.parserTrace.some((trace) => trace.stage === "table.csv" && trace.status === "completed"), true);
  if (directRuntime.payload.runtimes["tika.app"]?.available) {
    const msgPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-27");
    assert.ok(msgPayloadCorpus, "MSG payload must be present in corpus when Tika is available");
    assert.equal(msgPayloadCorpus.route.formatId, "email");
    assert.equal(msgPayloadCorpus.parserTrace.some((trace) => trace.stage === "email.msg.tika" && trace.status === "completed"), true);
    assert.equal(msgPayloadCorpus.parserTrace.some((trace) => trace.stage === "email.headers-body"), false);
    assert.ok(msgPayloadCorpus.quality.textCharacters > 0, "MSG Tika parser must produce distillable text");
  }
  const tarPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-16");
  assert.equal(tarPayloadCorpus.parserTrace.some((trace) => trace.stage === "archive.tar.container" && trace.status === "completed"), true);
  assert.equal(tarPayloadCorpus.parserTrace.some((trace) => trace.stage === "archive.expand-route" && trace.status === "completed"), true);
  const tarMarkdownChildCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-16!tar/architecture.md");
  assert.ok(tarMarkdownChildCorpus, "TAR Markdown child must be expanded into corpus");
  assert.equal(tarMarkdownChildCorpus.parentSourceId, "source-16");
  assert.equal(tarMarkdownChildCorpus.route.formatId, "markdown");
  assert.equal(tarMarkdownChildCorpus.parserTrace.some((trace) => trace.stage === "text.markdown" && trace.status === "completed"), true);
  const tgzPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-17");
  assert.equal(tgzPayloadCorpus.parserTrace.some((trace) => trace.stage === "archive.gzip.decompress" && trace.status === "completed"), true);
  assert.equal(tgzPayloadCorpus.parserTrace.some((trace) => trace.stage === "archive.tar.container" && trace.status === "completed"), true);
  const tgzJsonChildCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-17!tgz/metrics.json");
  assert.ok(tgzJsonChildCorpus, "TGZ JSON child must be expanded into corpus");
  assert.equal(tgzJsonChildCorpus.parentSourceId, "source-17");
  assert.equal(tgzJsonChildCorpus.route.formatId, "json");
  assert.equal(tgzJsonChildCorpus.parserTrace.some((trace) => trace.stage === "structured.json" && trace.status === "completed"), true);
  if (fileRefDocument) {
    const fileRefCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-18");
    assert.ok(fileRefCorpus, "filePath mounted source must be present in corpus");
    assert.equal(fileRefCorpus.route.formatId, "markdown");
    assert.equal(fileRefCorpus.quality.evidenceStrength, "parsed-payload");
    assert.equal(fileRefCorpus.quality.suppliedPayloadKind, "file-ref-stream");
    assert.equal(fileRefCorpus.windowPlan.strategy, "file-ref-stream-windowing.v1");
    assert.equal(fileRefCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed"), true);
    assert.equal(fileRefCorpus.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
    assert.equal(fileRefCorpus.windowPlan.windowCount > 1, true, "filePath large text must enter normal windowing");
  }
  if (deferredFileRefDocument) {
    const deferredFileRefCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-19");
    assert.ok(deferredFileRefCorpus, "oversized binary filePath source must remain visible in corpus");
    assert.equal(deferredFileRefCorpus.route.formatId, "pdf");
    assert.equal(deferredFileRefCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed"), true);
    assert.equal(deferredFileRefCorpus.parserTrace.some((trace) => trace.stage === "pdf.text.pdftotext"), true);
    assert.equal(deferredFileRefCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
  }
  if (binaryProfileFileRefDocument) {
    const binaryProfileCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-43");
    assert.ok(binaryProfileCorpus, "oversized unknown binary filePath source must remain visible in corpus");
    assert.equal(binaryProfileCorpus.route.formatId, "unknown");
    assert.equal(binaryProfileCorpus.quality.suppliedPayloadKind, "file-ref-binary-profile");
    assert.equal(binaryProfileCorpus.quality.distillable, false);
    assert.equal(/^sha256:[a-f0-9]{64}$/.test(binaryProfileCorpus.contentHash), true);
    assert.equal(binaryProfileCorpus.parserTrace.some((trace) => (
      trace.stage === "payload.file-ref-binary-profile" &&
      trace.status === "completed" &&
      trace.strategy === "bounded-binary-file-profile.v1" &&
      trace.directReadAvoided === true &&
      trace.hashedBytes === binaryProfileCorpus.byteSize
    )), true);
    assert.equal(binaryProfileCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
  }
  if (largeJsonFileRefDocument) {
    const largeJsonCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-51");
    assert.ok(largeJsonCorpus, "oversized JSON filePath source must remain visible in corpus");
    assert.equal(largeJsonCorpus.route.formatId, "json");
    assert.equal(largeJsonCorpus.quality.suppliedPayloadKind, "file-ref-stream");
    assert.equal(largeJsonCorpus.quality.distillable, true);
    assert.equal(largeJsonCorpus.windowPlan.strategy, "file-ref-stream-windowing.v1");
    assert.equal(largeJsonCorpus.windowPlan.windowCount > 1, true);
    assert.equal(/^sha256:[a-f0-9]{64}$/.test(largeJsonCorpus.contentHash), true);
    assert.equal(largeJsonCorpus.parserTrace.some((trace) => (
      trace.stage === "payload.file-ref" &&
      trace.status === "completed" &&
      trace.mode === "streaming-windowed"
    )), true);
    assert.equal(largeJsonCorpus.parserTrace.some((trace) => (
      trace.stage === "payload.stream-text" &&
      trace.status === "completed"
    )), true);
    assert.equal(largeJsonCorpus.parserTrace.some((trace) => (
      trace.stage === "structured.json.file-ref-stream" &&
      trace.status === "completed" &&
      trace.mode === "streaming-sample"
    )), true);
    assert.equal(largeJsonCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref-binary-profile"), false);
    assert.equal(largeJsonCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
  }
  if (mountedDirectoryDocument) {
    const directoryCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-74");
    assert.ok(directoryCorpus, "mounted directory parent must remain visible in corpus");
    assert.equal(directoryCorpus.route.formatId, "directory");
    assert.equal(directoryCorpus.quality.suppliedPayloadKind, "directory-file-ref");
    assert.equal(directoryCorpus.quality.distillable, false);
    assert.equal(directoryCorpus.parserTrace.some((trace) => trace.stage === "payload.directory-ref" && trace.status === "completed"), true);
    assert.equal(directoryCorpus.parserTrace.some((trace) => trace.stage === "directory.file-ref" && trace.status === "ready"), true);
    assert.equal(directoryCorpus.parserTrace.some((trace) => (
      trace.stage === "directory.file-ref.expand" &&
      trace.status === "completed" &&
      trace.strategy === "directory-file-ref-recursive-routing.v1" &&
      trace.childDocumentCount >= 3
    )), true);
    assert.equal(directoryCorpus.parserTrace.some((trace) => trace.stage === "directory.expand-route" && trace.status === "completed"), true);
    const directoryMarkdownChild = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-74!README.md");
    assert.ok(directoryMarkdownChild, "mounted directory Markdown child must be routed");
    assert.equal(directoryMarkdownChild.parentSourceId, "source-74");
    assert.equal(directoryMarkdownChild.route.formatId, "markdown");
    assert.equal(directoryMarkdownChild.quality.suppliedPayloadKind, "directory-entry-file-ref");
    assert.equal(directoryMarkdownChild.parserTrace.some((trace) => trace.stage === "directory.entry-file-ref" && trace.status === "expanded"), true);
    assert.equal(directoryMarkdownChild.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
    const directoryCsvChild = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-74!finance/invoices.csv");
    assert.ok(directoryCsvChild, "mounted directory CSV child must be routed");
    assert.equal(directoryCsvChild.parentSourceId, "source-74");
    assert.equal(directoryCsvChild.route.formatId, "spreadsheet");
    assert.equal(directoryCsvChild.parserTrace.some((trace) => trace.stage === "table.csv" && trace.status === "completed"), true);
    const directoryCodeChild = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-74!src/router.js");
    assert.ok(directoryCodeChild, "mounted directory source-code child must be routed");
    assert.equal(directoryCodeChild.route.formatId, "source-code");
    assert.equal(directoryCodeChild.parserTrace.some((trace) => trace.stage === "code.structure" && trace.status === "completed"), true);
    assert.equal(createRun.payload.result.corpusPlan.documents.some((document) => /node_modules/.test(document.sourceId)), false);
    const directorySupportGroup = createRun.payload.result.classification.groups.find((group) => group.sourceIds.includes("source-74"));
    assert.equal(directorySupportGroup?.kind, "container-manifest");
    assert.equal(directorySupportGroup?.excludedFromCore, true);
  }
  if (mountedArchiveDocument) {
    const mountedArchiveCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-20");
    assert.ok(mountedArchiveCorpus, "mounted archive parent must remain visible in corpus");
    assert.equal(mountedArchiveCorpus.route.formatId, "archive");
    assert.equal(mountedArchiveCorpus.quality.suppliedPayloadKind, "file-ref-archive");
    assert.equal(mountedArchiveCorpus.parserTrace.some((trace) => trace.stage === "archive.tar.extract" && trace.status === "completed"), true);
    assert.equal(mountedArchiveCorpus.parserTrace.some((trace) => trace.stage === "archive.file-ref.entries" && trace.status === "completed"), true);
    assert.equal(mountedArchiveCorpus.parserTrace.some((trace) => trace.stage === "archive.file-ref.expand" && trace.status === "completed"), true);
    assert.equal(mountedArchiveCorpus.parserTrace.some((trace) => trace.stage === "archive.expand-route" && trace.status === "completed"), true);
    const mountedArchiveMarkdownChild = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-20!mounted/large-project.md");
    assert.ok(mountedArchiveMarkdownChild, "mounted archive large Markdown child must be expanded");
    assert.equal(mountedArchiveMarkdownChild.parentSourceId, "source-20");
    assert.equal(mountedArchiveMarkdownChild.route.formatId, "markdown");
    assert.equal(mountedArchiveMarkdownChild.windowPlan.strategy, "file-ref-stream-windowing.v1");
    assert.equal(mountedArchiveMarkdownChild.parserTrace.some((trace) => trace.stage === "archive.entry-file-ref" && trace.status === "expanded"), true);
    assert.equal(mountedArchiveMarkdownChild.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
    assert.equal(mountedArchiveMarkdownChild.windowPlan.windowCount > 1, true);
  }
  if (mountedStructuredDocuments.length) {
    for (const [sourceId, formatId, stage] of [
      ["source-21", "word", "office.word.structured"],
      ["source-22", "presentation", "office.presentation.slides"],
      ["source-23", "spreadsheet", "table.sheet.structured"],
      ["source-24", "open-document", "open-document.structured"],
      ["source-25", "ebook", "ebook.epub"]
    ]) {
      const mountedStructuredCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === sourceId);
      assert.ok(mountedStructuredCorpus, `${sourceId} mounted structured ZIP document must be present in corpus`);
      assert.equal(mountedStructuredCorpus.route.formatId, formatId);
      assert.equal(mountedStructuredCorpus.quality.suppliedPayloadKind, "file-ref-structured-zip");
      assert.equal(mountedStructuredCorpus.elementPlan.strategy, "document-element-model.v1");
      assert.ok(mountedStructuredCorpus.elementPlan.elementCount >= 1, `${sourceId} mounted structured ZIP document must expose structured elements`);
      assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed"), true);
      assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "structured-zip.file-ref.extract" && trace.status === "completed"), true);
      assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
        trace.stage === "structured-zip.structural-entry-plan" &&
        trace.status === "completed" &&
        trace.strategy === "structured-zip-entry-bounded-or-streaming.v1" &&
        trace.loadedFiles >= 1
      )), true);
      assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === stage && trace.status === "completed"), true);
      if (formatId === "word") {
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "structured-zip.structural-entry-plan" &&
          trace.selectedFiles === 4 &&
          trace.loadedFiles === 4 &&
          trace.skippedLargeFiles === 0
        )), true);
        assert.equal(mountedStructuredCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.word.annotations" &&
          trace.status === "completed" &&
          trace.comments === 1 &&
          trace.footnotes === 1
        )), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.word.revisions" &&
          trace.status === "completed" &&
          trace.revisions === 2 &&
          trace.inserted === 1 &&
          trace.deleted === 1
        )), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.word.hyperlinks" &&
          trace.status === "completed" &&
          trace.links === 1
        )), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.word.images" &&
          trace.status === "completed" &&
          trace.images === 1
        )), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "comment" &&
          ref.annotation?.kind === "comment" &&
          ref.annotation?.author === "Mounted Reviewer"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "revision" &&
          ref.annotation?.kind === "word-revision" &&
          ref.annotation?.type === "insertion" &&
          ref.annotation?.author === "Mounted Revision Author"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "revision" &&
          ref.annotation?.kind === "word-revision" &&
          ref.annotation?.type === "deletion" &&
          ref.annotation?.author === "Mounted Revision Author"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "link" &&
          ref.href === "https://example.com/mounted-docx"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "image" &&
          ref.href === "word/media/mounted-architecture.png" &&
          ref.image?.relationshipId === "rIdImage1"
        ))), true);
      } else if (formatId === "presentation") {
        assert.equal(mountedStructuredCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.presentation.layouts" &&
          trace.status === "completed" &&
          trace.slideLayouts === 1 &&
          trace.slideMasters === 1 &&
          trace.layoutRefs === 1 &&
          trace.masterRefs === 1
        )), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "slide-layout" &&
          ref.presentation?.layoutPart === "ppt/slideLayouts/slideLayout1.xml" &&
          ref.presentation?.masterPart === "ppt/slideMasters/slideMaster1.xml"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "slide-master" &&
          ref.presentation?.masterPart === "ppt/slideMasters/slideMaster1.xml"
        ))), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.presentation.tables" &&
          trace.status === "completed" &&
          trace.tables === 1 &&
          trace.cells === 4
        )), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.presentation.speaker-notes" &&
          trace.status === "completed" &&
          trace.notes === 1
        )), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.presentation.comments" &&
          trace.status === "completed" &&
          trace.comments === 1
        )), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.presentation.hyperlinks" &&
          trace.status === "completed" &&
          trace.links === 1
        )), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => (
          trace.stage === "office.presentation.images" &&
          trace.status === "completed" &&
          trace.images === 1
        )), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "table-row" &&
          ref.table?.format === "presentationml" &&
          ref.cells?.some((cell) => cell.ref === "B2" && cell.header === "Decision")
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "link" &&
          ref.href === "https://example.com/mounted-pptx"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "image" &&
          ref.href === "ppt/media/mounted-roadmap.png" &&
          ref.image?.relationshipId === "rIdImage1"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "speaker-note" &&
          ref.layout?.strategy === "presentationml-speaker-notes.v1"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "comment" &&
          ref.annotation?.kind === "presentation-comment" &&
          ref.annotation?.author === "Mounted Slide Reviewer" &&
          ref.annotation?.sourcePart === "ppt/comments/comment1.xml"
        ))), true);
      } else if (formatId === "spreadsheet") {
        assert.equal(mountedStructuredCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.workbook.sheets" && trace.status === "completed" && trace.sheets === 1 && trace.sheetRefs === 1), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.workbook.defined-names" && trace.status === "completed" && trace.definedNames === 1), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.headers" && trace.status === "completed"), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.cells" && trace.status === "completed" && trace.cells >= 4), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.merged-cells" && trace.status === "completed" && trace.mergedCells === 1), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.comments" && trace.status === "completed" && trace.comments === 1), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.formulas" && trace.status === "completed" && trace.formulas === 1), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.hyperlinks" && trace.status === "completed" && trace.hyperlinks === 1), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "table.time-index" && trace.status === "completed" && trace.from === "2026-06-15"), true);
        assert.equal(mountedStructuredCorpus.timeRange.from, "2026-06-15");
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.timeRange?.from === "2026-06-15"), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "defined-name" &&
          ref.definedName?.name === "MountedEvidenceRange" &&
          ref.definedName?.ref === "Mounted Evidence!A1:D2"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "merged-cell" &&
          ref.merge?.ref === "A1:B1" &&
          ref.table?.sheetName === "Mounted Evidence"
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "cell-comment" &&
          ref.annotation?.kind === "spreadsheet-comment" &&
          ref.annotation?.author === "Mounted Analyst" &&
          ref.cells?.some((cell) => cell.ref === "B2" && cell.comment?.text.includes("status comment"))
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "table-row" &&
          ref.table?.format === "xlsx" &&
          ref.table?.sheetName === "Mounted Evidence" &&
          ref.table?.sheetId === "9" &&
          ref.cells?.some((cell) => cell.ref === "D2" && cell.header === "Evidence Score" && cell.formula === "LEN(B2)")
        ))), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "table-row" &&
          ref.table?.format === "xlsx" &&
          ref.cells?.some((cell) => cell.ref === "B2" && cell.hyperlink?.target === "https://example.com/container-xlsx")
        ))), true);
      } else if (formatId === "open-document") {
        assert.equal(mountedStructuredCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "open-document.hyperlinks" && trace.status === "completed" && trace.links === 1), true);
        assert.equal(mountedStructuredCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
          ref.type === "link" &&
          ref.href === "https://example.com/mounted-odf"
        ))), true);
      } else {
        assert.equal(mountedStructuredCorpus.windowPlan.strategy, "file-ref-stream-windowing.v1");
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "document.structure.elements" && trace.status === "completed"), true);
        assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
      }
      assert.equal(mountedStructuredCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
      assert.ok(mountedStructuredCorpus.quality.textCharacters > 0, `${sourceId} mounted structured ZIP document must produce text`);
    }
    const largeStructuredWord = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-42");
    assert.ok(largeStructuredWord, "large mounted DOCX structural XML document must be present");
    assert.equal(largeStructuredWord.route.formatId, "word");
    assert.equal(largeStructuredWord.quality.suppliedPayloadKind, "file-ref-structured-zip");
    assert.equal(largeStructuredWord.parserTrace.some((trace) => (
      trace.stage === "structured-zip.structural-entry-plan" &&
      trace.status === "completed" &&
      trace.selectedFiles === 1 &&
      trace.loadedFiles === 0 &&
      trace.skippedLargeFiles === 1 &&
      trace.maxEntryBytes === 25000
    )), true);
    assert.equal(largeStructuredWord.parserTrace.some((trace) => (
      trace.stage === "structured-zip.large-entry-stream" &&
      trace.status === "completed" &&
      trace.reason === "large-structure-entry"
    )), true);
    assert.equal(largeStructuredWord.windowPlan.strategy, "file-ref-stream-windowing.v1");
    assert.equal(largeStructuredWord.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
    assert.ok(largeStructuredWord.quality.textCharacters > 25000, "large DOCX structural fallback must preserve oversized text");
  }
  if (directRuntime.payload.runtimes["tika.app"]?.available && mountedLegacyOfficeDocuments.length) {
    for (const [sourceId, formatId] of [
      ["source-30", "word"],
      ["source-31", "word"],
      ["source-32", "presentation"],
      ["source-33", "spreadsheet"]
    ]) {
      const mountedLegacyCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === sourceId);
      assert.ok(mountedLegacyCorpus, `${sourceId} mounted legacy Office document must be present in corpus`);
      assert.equal(mountedLegacyCorpus.route.formatId, formatId);
      assert.equal(mountedLegacyCorpus.quality.suppliedPayloadKind, "file-ref-tika");
      assert.equal(mountedLegacyCorpus.windowPlan.strategy, "file-ref-stream-windowing.v1");
      assert.equal(mountedLegacyCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed"), true);
      assert.equal(mountedLegacyCorpus.parserTrace.some((trace) => trace.stage === "tika.text.file-ref" && trace.status === "completed"), true);
      assert.equal(mountedLegacyCorpus.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
      assert.equal(mountedLegacyCorpus.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
      assert.ok(mountedLegacyCorpus.quality.textCharacters > 0, `${sourceId} mounted legacy Office document must produce text`);
    }
  }
  const pdfPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-12");
  assert.equal(pdfPayloadCorpus.pdfProfile.strategy, "pdf-subtype-routing.v1");
  assert.equal(pdfPayloadCorpus.pdfProfile.subtype, "pdf-text");
  assert.equal(pdfPayloadCorpus.route.pdfSubtype, "pdf-text");
  assert.equal(pdfPayloadCorpus.parserTrace.some((trace) => trace.stage === "pdf.subtype-route" && trace.subtype === "pdf-text"), true);
  assert.equal(pdfPayloadCorpus.parserTrace.some((trace) => trace.stage === "pdf.text.basic" && trace.status === "completed" && trace.layoutBlocks >= 1 && trace.layoutStrategy === "pdf-text-operator-geometry.v1"), true);
  assert.equal(pdfPayloadCorpus.parserTrace.some((trace) => trace.stage === "pdf.hyperlinks" && trace.status === "completed" && trace.links === 1), true);
  assert.equal(pdfPayloadCorpus.parserTrace.some((trace) => trace.stage === "pdf.outlines" && trace.status === "completed" && trace.outlines === 2), true);
  assert.equal(pdfPayloadCorpus.parserTrace.some((trace) => trace.stage === "pdf.form-fields" && trace.status === "completed" && trace.fields === 1 && trace.widgets === 1), true);
  assert.equal(pdfPayloadCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(pdfPayloadCorpus.elementPlan.sourceFormat, "pdf");
  assert.equal(pdfPayloadCorpus.elementPlan.elementTypes["pdf-text-block"] >= 1, true);
  assert.equal(pdfPayloadCorpus.elementPlan.elementTypes["pdf-outline"] >= 2, true);
  assert.equal(pdfPayloadCorpus.elementPlan.elementTypes["pdf-form-field"] >= 1, true);
  assert.equal(pdfPayloadCorpus.elementPlan.elementTypes.link >= 1, true);
  assert.equal(pdfPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "pdf-outline" &&
    element.text.includes("PDF Architecture Overview") &&
    element.page === 1 &&
    element.layout?.strategy === "pdf-outline-destination.v1"
  )), true);
  assert.equal(pdfPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "pdf-text-block" &&
    element.page === 1 &&
    element.bbox?.x === 72 &&
    element.bbox?.y === 720 &&
    element.layout?.strategy === "pdf-text-operator-geometry.v1"
  )), true);
  assert.equal(pdfPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "pdf-form-field" &&
    element.page === 1 &&
    element.bbox?.x === 72 &&
    element.bbox?.y === 640 &&
    element.layout?.strategy === "pdf-form-field.v1" &&
    element.form?.name === "Project Owner" &&
    element.form?.value === "Platform Team" &&
    element.form?.fieldType === "text"
  )), true);
  assert.equal(pdfPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "link" &&
    element.href === "https://example.test/pdf-evidence" &&
    element.page === 1 &&
    element.bbox?.x === 72 &&
    element.layout?.strategy === "pdf-uri-annotation.v1"
  )), true);
  assert.equal(pdfPayloadCorpus.formatConversionProfile.parserProfile, "pdf.text-layout-ocr-route");
  assert.equal(pdfPayloadCorpus.formatConversionProfile.preserves.includes("bbox"), true);
  assert.equal(pdfPayloadCorpus.formatConversionProfile.preserves.includes("links"), true);
  assert.equal(pdfPayloadCorpus.formatConversionProfile.preserves.includes("outline"), true);
  assert.equal(pdfPayloadCorpus.formatConversionProfile.preserves.includes("formFields"), true);
  assert.equal(pdfPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(pdfPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "pdf-outline" &&
    ref.page === 1 &&
    ref.layout?.strategy === "pdf-outline-destination.v1"
  )) && /PDF Architecture Overview/.test(window.excerpt || "")), true);
  assert.equal(pdfPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "pdf-text-block" &&
    ref.page === 1 &&
    ref.bbox?.x === 72 &&
    ref.bbox?.y === 720 &&
    ref.layout?.strategy === "pdf-text-operator-geometry.v1"
  ))), true);
  assert.equal(pdfPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "pdf-form-field" &&
    ref.form?.name === "Project Owner" &&
    ref.form?.value === "Platform Team" &&
    ref.page === 1 &&
    ref.layout?.strategy === "pdf-form-field.v1"
  ))), true);
  assert.equal(pdfPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.href === "https://example.test/pdf-evidence" &&
    ref.page === 1 &&
    ref.layout?.strategy === "pdf-uri-annotation.v1"
  ))), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-12" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "pdf-outline" &&
      ref.layout?.strategy === "pdf-outline-destination.v1"
    )) &&
    /PDF Architecture Overview/.test(unit.text || "")
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-12" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "pdf-text-block" &&
      ref.bbox?.x === 72 &&
      ref.layout?.strategy === "pdf-text-operator-geometry.v1"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-12" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "pdf-form-field" &&
      ref.form?.name === "Project Owner" &&
      ref.form?.value === "Platform Team" &&
      ref.layout?.strategy === "pdf-form-field.v1"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-12" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "link" &&
      ref.href === "https://example.test/pdf-evidence" &&
      ref.layout?.strategy === "pdf-uri-annotation.v1"
    ))
  )), true);
  assert.equal(pdfPayloadCorpus.windowPlan.windowCount >= 1, true);
  const pptxPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-13");
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => trace.stage === "office.presentation.slides" && trace.status === "completed"), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.slides" &&
    trace.geometries >= 2 &&
    trace.layoutStrategy === "presentationml-shape-geometry.v1"
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.layouts" &&
    trace.status === "completed" &&
    trace.slideLayouts === 1 &&
    trace.slideMasters === 1 &&
    trace.layoutRefs === 1 &&
    trace.masterRefs === 1
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.placeholders" &&
    trace.status === "completed" &&
    trace.placeholders === 2 &&
    trace.shapeMetadata >= 2
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.tables" &&
    trace.status === "completed" &&
    trace.tables === 1 &&
    trace.cells === 4 &&
    trace.layoutStrategy === "presentationml-table-geometry.v1"
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.speaker-notes" &&
    trace.status === "completed" &&
    trace.notes === 1
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.comments" &&
    trace.status === "completed" &&
    trace.comments === 1 &&
    trace.authors === 1
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.hyperlinks" &&
    trace.status === "completed" &&
    trace.links === 1
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.images" &&
    trace.status === "completed" &&
    trace.images === 1 &&
    trace.geometries === 1
  )), true);
  assert.equal(pptxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.presentation.charts" &&
    trace.status === "completed" &&
    trace.charts === 1 &&
    trace.chartSeries === 1 &&
    trace.geometries === 1
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(pptxPayloadCorpus.elementPlan.sourceFormat, "pptx");
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes["slide-layout"] >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes["slide-master"] >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes.heading >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes["slide-shape"] >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes["table-header"] >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes["table-row"] >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes.link >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes.image >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes.chart >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes["speaker-note"] >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.elementTypes.comment >= 1, true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "slide-layout" &&
    element.page === 1 &&
    element.layout?.strategy === "presentationml-slide-layout-ref.v1" &&
    element.presentation?.kind === "slide-layout" &&
    element.presentation?.slidePart === "ppt/slides/slide1.xml" &&
    element.presentation?.layoutPart === "ppt/slideLayouts/slideLayout1.xml" &&
    element.presentation?.masterPart === "ppt/slideMasters/slideMaster1.xml" &&
    element.presentation?.relationshipId === "rIdLayout1" &&
    element.presentation?.layoutName === "Roadmap Layout"
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "slide-master" &&
    element.page === 1 &&
    element.layout?.strategy === "presentationml-slide-master-ref.v1" &&
    element.presentation?.kind === "slide-master" &&
    element.presentation?.layoutPart === "ppt/slideLayouts/slideLayout1.xml" &&
    element.presentation?.masterPart === "ppt/slideMasters/slideMaster1.xml" &&
    element.presentation?.masterRelationshipId === "rIdMaster1" &&
    element.presentation?.masterName === "Knowledge Distillation Master"
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "heading" &&
    element.page === 1 &&
    element.bbox?.x === 72 &&
    element.bbox?.y === 36 &&
    element.shape?.id === "2" &&
    element.shape?.name === "Roadmap Title" &&
    element.shape?.placeholderType === "title" &&
    element.layout?.strategy === "presentationml-shape-geometry.v1"
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "slide-shape" &&
    element.page === 1 &&
    element.shape?.id === "3" &&
    element.shape?.name === "Roadmap Body" &&
    element.shape?.placeholderType === "body" &&
    element.shape?.placeholderIndex === "1"
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "table-row" &&
    element.page === 1 &&
    element.bbox?.x === 72 &&
    element.bbox?.y === 204 &&
    element.table?.format === "presentationml" &&
    element.cells?.some((cell) => cell.ref === "B2" && cell.header === "Decision" && cell.value.includes("PowerPoint table cells"))
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "speaker-note" &&
    element.page === 1 &&
    element.layout?.strategy === "presentationml-speaker-notes.v1" &&
    element.text.includes("Speaker note keeps release risk")
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "comment" &&
    element.page === 1 &&
    element.annotation?.kind === "presentation-comment" &&
    element.annotation?.author === "Slide Reviewer" &&
    element.text.includes("confirmed the roadmap decision")
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "link" &&
    element.page === 1 &&
    element.href === "https://example.com/pptx-evidence" &&
    element.text.includes("Presentation evidence portal")
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "image" &&
    element.page === 1 &&
    element.href === "ppt/media/roadmap.png" &&
    element.image?.relationshipId === "rIdImage1" &&
    element.image?.target === "ppt/media/roadmap.png" &&
    element.image?.description === "PPTX roadmap diagram evidence" &&
    element.shape?.id === "5" &&
    element.shape?.name === "Roadmap Diagram" &&
    element.bbox?.x === 72 &&
    element.bbox?.y === 144 &&
    element.layout?.strategy === "presentationml-image-ref.v1"
  )), true);
  assert.equal(pptxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "chart" &&
    element.page === 1 &&
    element.href === "ppt/charts/chart1.xml" &&
    element.chart?.relationshipId === "rIdChart1" &&
    element.chart?.chartPart === "ppt/charts/chart1.xml" &&
    element.chart?.title === "PPTX Roadmap Trend" &&
    element.chart?.series?.some((series) => series.name === "Slide Evidence Count" && series.categories.includes("Q2")) &&
    element.shape?.id === "6" &&
    element.shape?.name === "Roadmap Trend Chart" &&
    element.layout?.strategy === "presentationml-chart-ref.v1"
  )), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("links"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("images"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("charts"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("chartSeries"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("shape-placeholder"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("slide-layout"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("slide-master"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("speaker-notes"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("comments"), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "slide-layout" &&
    ref.presentation?.layoutPart === "ppt/slideLayouts/slideLayout1.xml" &&
    ref.presentation?.masterPart === "ppt/slideMasters/slideMaster1.xml"
  ))), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "slide-master" &&
    ref.presentation?.masterPart === "ppt/slideMasters/slideMaster1.xml" &&
    ref.layout?.strategy === "presentationml-slide-master-ref.v1"
  ))), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "speaker-note" &&
    ref.page === 1 &&
    ref.layout?.strategy === "presentationml-speaker-notes.v1"
  ))), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "comment" &&
    ref.page === 1 &&
    ref.annotation?.kind === "presentation-comment" &&
    ref.annotation?.author === "Slide Reviewer"
  ))), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.page === 1 &&
    ref.href === "https://example.com/pptx-evidence"
  ))), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "image" &&
    ref.page === 1 &&
    ref.image?.relationshipId === "rIdImage1" &&
    ref.layout?.strategy === "presentationml-image-ref.v1"
  ))), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "chart" &&
    ref.page === 1 &&
    ref.chart?.relationshipId === "rIdChart1" &&
    ref.layout?.strategy === "presentationml-chart-ref.v1"
  ))), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "slide-layout" &&
      ref.presentation?.layoutPart === "ppt/slideLayouts/slideLayout1.xml"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "slide-master" &&
      ref.presentation?.masterPart === "ppt/slideMasters/slideMaster1.xml"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => ref.type === "speaker-note")
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "comment" &&
      ref.annotation?.kind === "presentation-comment" &&
      ref.annotation?.author === "Slide Reviewer"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "link" &&
      ref.href === "https://example.com/pptx-evidence"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "image" &&
      ref.image?.target === "ppt/media/roadmap.png"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "chart" &&
      ref.chart?.chartPart === "ppt/charts/chart1.xml" &&
      ref.chart?.series?.some((series) => series.name === "Slide Evidence Count")
    ))
  )), true);
  assert.equal(pptxPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "slide-shape" &&
    ref.page === 1 &&
    ref.bbox?.x === 72 &&
    ref.bbox?.y === 108 &&
    ref.shape?.placeholderType === "body" &&
    ref.layout?.strategy === "presentationml-shape-geometry.v1"
  ))), true);
  assert.equal(pptxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-row" &&
    ref.page === 1 &&
    ref.table?.format === "presentationml" &&
    ref.cells?.some((cell) => cell.ref === "B2")
  ))), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.parserProfile, "presentationml-slide-route");
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("slide-order"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("shape-bbox"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("shape-id"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("shape-name"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("slide-layout"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("slide-master"), true);
  assert.equal(pptxPayloadCorpus.formatConversionProfile.preserves.includes("cellRefs"), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "slide-shape" &&
      ref.bbox?.x === 72 &&
      ref.shape?.id === "3" &&
      ref.shape?.placeholderType === "body" &&
      ref.layout?.strategy === "presentationml-shape-geometry.v1"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-13" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "table-row" &&
      ref.table?.format === "presentationml" &&
      ref.cells?.some((cell) => cell.ref === "B2")
    ))
  )), true);
  const visioPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-75");
  assert.ok(visioPayloadCorpus, "Visio payload corpus document must be present");
  assert.equal(visioPayloadCorpus.route.formatId, "visio");
  assert.equal(visioPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.visio.pages" &&
    trace.status === "completed" &&
    trace.pages === 1 &&
    trace.shapes === 3 &&
    trace.textShapes === 3 &&
    trace.connectors === 2
  )), true);
  assert.equal(visioPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.visio.shapes" &&
    trace.status === "completed" &&
    trace.geometries === 2 &&
    trace.layoutStrategy === "visio-shape-geometry.v1"
  )), true);
  assert.equal(visioPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "office.visio.connectors" &&
    trace.status === "completed" &&
    trace.connectors === 2
  )), true);
  assert.equal(visioPayloadCorpus.elementPlan.sourceFormat, "vsdx");
  assert.equal(visioPayloadCorpus.elementPlan.elementTypes["visio-shape"] >= 3, true);
  assert.equal(visioPayloadCorpus.elementPlan.elementTypes["visio-connector"] >= 2, true);
  assert.equal(visioPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "visio-shape" &&
    element.shape?.id === "2" &&
    element.shape?.name === "Decision" &&
    element.shape?.type === "Shape" &&
    element.layout?.strategy === "visio-shape-geometry.v1" &&
    element.bbox?.x === 3 &&
    element.text.includes("Route-first Visio parsing")
  )), true);
  assert.equal(visioPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(visioPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "visio-connector" &&
    ref.shape?.id === "3->2" &&
    ref.layout?.strategy === "visio-connector-ref.v1"
  ))), true);
  assert.equal(visioPayloadCorpus.formatConversionProfile.parserProfile, "visio-opc-page-shape-route");
  assert.equal(visioPayloadCorpus.formatConversionProfile.preserves.includes("connectors"), true);
  assert.equal(visioPayloadCorpus.formatConversionProfile.conversionAdapters.some((adapter) => adapter.targetFormat === "docx"), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-75" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "visio-shape" &&
      ref.shape?.name === "Decision" &&
      ref.layout?.strategy === "visio-shape-geometry.v1"
    ))
  )), true);
  const xlsxPayloadCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "source-14");
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.structured" && trace.status === "completed"), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "table.workbook.sheets" &&
    trace.status === "completed" &&
    trace.sheets === 1 &&
    trace.sheetRefs === 1
  )), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => (
    trace.stage === "table.workbook.defined-names" &&
    trace.status === "completed" &&
    trace.definedNames === 2 &&
    trace.namedRanges === 1 &&
    trace.printAreas === 1
  )), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.headers" && trace.status === "completed"), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.cells" && trace.status === "completed" && trace.cells >= 4), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.merged-cells" && trace.status === "completed" && trace.mergedCells === 1), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.comments" && trace.status === "completed" && trace.comments === 1), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.date-styles" && trace.status === "completed" && trace.dateStyles === 1 && trace.dateCells === 1), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.formulas" && trace.status === "completed" && trace.formulas === 1), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.hyperlinks" && trace.status === "completed" && trace.hyperlinks === 1), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.sheet.charts" && trace.status === "completed" && trace.charts === 1 && trace.chartSeries === 1), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.strategy, "document-element-model.v1");
  assert.equal(xlsxPayloadCorpus.elementPlan.sourceFormat, "xlsx");
  assert.equal(xlsxPayloadCorpus.elementPlan.elementTypes["table-header"] >= 1, true);
  assert.equal(xlsxPayloadCorpus.elementPlan.elementTypes["table-row"] >= 1, true);
  assert.equal(xlsxPayloadCorpus.elementPlan.elementTypes["merged-cell"] >= 1, true);
  assert.equal(xlsxPayloadCorpus.elementPlan.elementTypes["cell-comment"] >= 1, true);
  assert.equal(xlsxPayloadCorpus.elementPlan.elementTypes["defined-name"] >= 2, true);
  assert.equal(xlsxPayloadCorpus.elementPlan.elementTypes.chart >= 1, true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "defined-name" &&
    element.definedName?.name === "DecisionRange" &&
    element.definedName?.builtinType === "named-range" &&
    element.definedName?.sheetName === "Finance Evidence" &&
    element.definedName?.ref === "Finance Evidence!A1:D2" &&
    element.definedName?.ranges?.some((range) => range.ref === "A1:D2" && range.cellRefs?.includes("D2"))
  )), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "defined-name" &&
    element.definedName?.name === "_xlnm.Print_Area" &&
    element.definedName?.builtinType === "print-area" &&
    element.definedName?.ref === "Finance Evidence!A1:D2"
  )), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "merged-cell" &&
    element.table?.format === "xlsx" &&
    element.table?.sheetName === "Finance Evidence" &&
    element.merge?.ref === "A1:B1" &&
    element.merge?.masterRef === "A1" &&
    element.merge?.startRef === "A1" &&
    element.merge?.endRef === "B1" &&
    element.merge?.rowSpan === 1 &&
    element.merge?.columnSpan === 2 &&
    element.merge?.cellRefs?.includes("B1")
  )), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "cell-comment" &&
    element.table?.format === "xlsx" &&
    element.table?.sheetName === "Finance Evidence" &&
    element.annotation?.kind === "spreadsheet-comment" &&
    element.annotation?.author === "Finance Reviewer" &&
    element.cells?.some((cell) => (
      cell.ref === "B2" &&
      cell.comment?.author === "Finance Reviewer" &&
      cell.comment?.text.includes("confirmed the total evidence") &&
      cell.comment?.relationshipId === "rIdComment1" &&
      cell.comment?.target === "xl/comments1.xml"
    ))
  )), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "table-row" &&
    element.table?.format === "xlsx" &&
    element.table?.sheetName === "Finance Evidence" &&
    element.table?.sheetId === "7" &&
    element.table?.relationshipId === "rIdSheet1" &&
    element.table?.worksheetPath === "xl/worksheets/sheet1.xml" &&
    element.cells?.some((cell) => (
      cell.ref === "C2" &&
      cell.header === "Payment Date" &&
      cell.value === "2026-05-31" &&
      cell.rawValue === "46173" &&
      cell.dateIso === "2026-05-31" &&
      cell.dateSerial === "46173" &&
      cell.style?.numFmtId === 14
    ))
  )), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "table-row" &&
    element.table?.format === "xlsx" &&
    element.cells?.some((cell) => cell.ref === "D2" && cell.header === "Projected Total" && cell.value === "84" && cell.formula === "B2*2")
  )), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "table-row" &&
    element.table?.format === "xlsx" &&
    element.cells?.some((cell) => cell.ref === "A2" && cell.hyperlink?.target === "https://example.com/acme")
  )), true);
  assert.equal(xlsxPayloadCorpus.elementPlan.sampleElements.some((element) => (
    element.type === "chart" &&
    element.table?.format === "xlsx" &&
    element.table?.sheetName === "Finance Evidence" &&
    element.chart?.relationshipId === "rIdChart1" &&
    element.chart?.chartPart === "xl/charts/chart1.xml" &&
    element.chart?.title === "XLSX Finance Trend" &&
    element.chart?.sheetName === "Finance Evidence" &&
    element.chart?.worksheetPath === "xl/worksheets/sheet1.xml" &&
    element.chart?.series?.some((series) => series.name === "Finance Evidence Count" && series.values.includes("84"))
  )), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.parserProfile, "spreadsheetml-sheet-row-cell-route");
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("cellRefs"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("sheetName"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("sheetId"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("definedNames"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("namedRanges"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("printAreas"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("mergedCells"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("cellComments"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("dateSerials"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("formulas"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("hyperlinks"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("charts"), true);
  assert.equal(xlsxPayloadCorpus.formatConversionProfile.preserves.includes("chartSeries"), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => ref.type === "table-row")), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "defined-name" &&
    ref.definedName?.name === "DecisionRange" &&
    ref.definedName?.ref === "Finance Evidence!A1:D2"
  ))), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "merged-cell" &&
    ref.merge?.ref === "A1:B1" &&
    ref.merge?.masterRef === "A1"
  ))), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-header" &&
    ref.cells?.some((cell) => cell.ref === "A1" && cell.merge?.ref === "A1:B1")
  ))), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "cell-comment" &&
    ref.annotation?.kind === "spreadsheet-comment" &&
    ref.cells?.some((cell) => cell.ref === "B2" && cell.comment?.text.includes("confirmed the total evidence"))
  ))), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-row" &&
    ref.table?.format === "xlsx" &&
    ref.table?.sheetName === "Finance Evidence" &&
    ref.table?.sheetId === "7" &&
    ref.cells?.some((cell) => cell.ref === "C2" && cell.dateIso === "2026-05-31" && cell.dateSerial === "46173")
  ))), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-row" &&
    ref.table?.format === "xlsx" &&
    ref.cells?.some((cell) => cell.ref === "D2" && cell.formula === "B2*2")
  ))), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-row" &&
    ref.table?.format === "xlsx" &&
    ref.cells?.some((cell) => cell.ref === "A2" && cell.hyperlink?.target === "https://example.com/acme")
  ))), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "chart" &&
    ref.table?.sheetName === "Finance Evidence" &&
    ref.chart?.relationshipId === "rIdChart1" &&
    ref.chart?.series?.some((series) => series.name === "Finance Evidence Count")
  ))), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-14" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "defined-name" &&
      ref.definedName?.name === "DecisionRange" &&
      ref.definedName?.ref === "Finance Evidence!A1:D2"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-14" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "merged-cell" &&
      ref.merge?.ref === "A1:B1"
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-14" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "cell-comment" &&
      ref.annotation?.kind === "spreadsheet-comment" &&
      ref.cells?.some((cell) => cell.comment?.author === "Finance Reviewer")
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-14" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "table-row" &&
      ref.table?.format === "xlsx" &&
      ref.table?.worksheetPath === "xl/worksheets/sheet1.xml" &&
      ref.cells?.some((cell) => cell.ref === "C2" && cell.dateIso === "2026-05-31")
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-14" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "table-row" &&
      ref.table?.format === "xlsx" &&
      ref.cells?.some((cell) => cell.ref === "A2" && cell.hyperlink?.target === "https://example.com/acme")
    ))
  )), true);
  assert.equal(createRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "source-14" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "chart" &&
      ref.chart?.chartPart === "xl/charts/chart1.xml" &&
      ref.chart?.series?.some((series) => series.name === "Finance Evidence Count")
    ))
  )), true);
  assert.equal(xlsxPayloadCorpus.parserTrace.some((trace) => trace.stage === "table.time-index" && trace.status === "completed" && trace.from === "2026-05-31"), true);
  assert.equal(xlsxPayloadCorpus.eventTime, "2026-05-31");
  assert.equal(xlsxPayloadCorpus.timeRange.from, "2026-05-31");
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => /Sheet 1 \(Finance Evidence\) (?:Merged range|Header row)|merge A1:B1|A=Vendor|B=Total|C=Payment Date/.test(window.excerpt || "")), true);
  assert.equal(xlsxPayloadCorpus.windowPlan.windows.some((window) => window.timeRange?.from === "2026-05-31"), true);
  for (const [sourceId, formatId, signature, sniffedExtension, parserStage] of [
    ["source-44", "pdf", "pdf-header", ".pdf", "pdf.text.basic"],
    ["source-45", "word", "zip-ooxml-word", ".docx", "office.word.structured"],
    ["source-46", "presentation", "zip-ooxml-presentation", ".pptx", "office.presentation.slides"],
    ["source-47", "spreadsheet", "zip-ooxml-spreadsheet", ".xlsx", "table.sheet.structured"],
    ["source-76", "visio", "zip-ooxml-visio", ".vsdx", "office.visio.pages"]
  ]) {
    const signatureRoutedCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === sourceId);
    assert.ok(signatureRoutedCorpus, `${sourceId} content-signature routed office document must be present`);
    assert.equal(signatureRoutedCorpus.route.formatId, formatId);
    assert.equal(signatureRoutedCorpus.route.declaredExtension, ".asset");
    assert.equal(signatureRoutedCorpus.route.declaredMediaType, "application/octet-stream");
    assert.equal(signatureRoutedCorpus.route.sniffedExtension, sniffedExtension);
    assert.equal(signatureRoutedCorpus.route.contentSignature, signature);
    assert.equal(signatureRoutedCorpus.parserTrace.some((trace) => (
      trace.stage === "content.signature" &&
      trace.status === "completed" &&
      trace.applied === true &&
      trace.signature === signature
    )), true);
    assert.equal(signatureRoutedCorpus.parserTrace.some((trace) => trace.stage === parserStage && trace.status === "completed"), true);
    assert.equal(signatureRoutedCorpus.formatConversionProfile.conversionAdapters.some((adapter) => adapter.targetFormat === "docx"), true);
  }
  for (const [sourceId, formatId, extension, parserStage] of [
    ["source-48", "word", ".docm", "office.word.structured"],
    ["source-49", "presentation", ".pptm", "office.presentation.slides"],
    ["source-50", "spreadsheet", ".xlsm", "table.sheet.structured"]
  ]) {
    const officeVariantCorpus = createRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === sourceId);
    assert.ok(officeVariantCorpus, `${sourceId} OOXML variant document must be present`);
    assert.equal(officeVariantCorpus.route.formatId, formatId);
    assert.equal(officeVariantCorpus.route.extension, extension);
    assert.equal(officeVariantCorpus.parserTrace.some((trace) => trace.stage === parserStage && trace.status === "completed"), true);
    assert.equal(officeVariantCorpus.formatConversionProfile.conversionAdapters.some((adapter) => adapter.targetFormat === "docx"), true);
  }
  assert.ok(
    createRun.payload.result.agentMessage.corpusPlan.documents.some((document) => document.sourceId === "source-3"),
    "agent message must include corpus window details"
  );
  assert.equal(createRun.payload.result.grounding.strategy, "claim-evidence-topk-conflict-gating.v2");
  assert.equal(createRun.payload.result.grounding.claims.some((claim) => (
    claim.source === "generated-summary" &&
    claim.topEvidence.length >= 1 &&
    claim.topEvidence.every((evidence) => evidence.groupId === claim.groupId)
  )), true);
  assert.equal(Object.values(createRun.payload.result.grounding.promotionGates).some((gate) => gate.promoted), true);
  assert.equal(createRun.payload.result.grounding.claims.some((claim) => (
    claim.source === "requested-claim" &&
    claim.text.includes("external.knowledge.distillation") &&
    claim.status === "entailed"
  )), true);
  assert.equal(createRun.payload.result.grounding.claims.some((claim) => (
    claim.source === "requested-claim" &&
    claim.text.includes("Submarine coffee") &&
    claim.status === "neutral" &&
    claim.evidenceRefs.length === 0
  )), true);
  assert.equal(
    createRun.payload.result.candidates.some((candidate) => candidate.sourceIds.includes("source-11")),
    false,
    "garbage/noise sources must not be promoted as core candidates"
  );
  assert.equal(
    createRun.payload.result.candidates.every((candidate) => candidate.promoted && candidate.promotionGate.entailed >= 1),
    true,
    "only claim-grounded groups may become candidates"
  );

  if (rawDocumentsManifestPath) {
    const manifestRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST" })
      },
      body: JSON.stringify({
        query: "Streaming manifest input verification",
        title: "Streaming manifest input verification",
        workflowScope: "corpus",
        responseProfile: "agent",
        rawDocumentsManifestPath
      })
    });
    assert.equal(manifestRun.status, 201);
    assert.equal(manifestRun.payload.status, "completed");
    assert.equal(manifestRun.payload.inputSummary.inputDocumentPlan.strategy, "inline-or-streaming-manifest-document-input.v1");
    assert.equal(manifestRun.payload.inputSummary.inputDocumentPlan.manifestDocumentCount, 2);
    assert.equal(manifestRun.payload.inputSummary.inputDocumentPlan.manifests.some((manifest) => (
      manifest.stage === "input.manifest.jsonl" &&
      manifest.status === "completed" &&
      manifest.documentCount === 2
    )), true);
    assert.equal(manifestRun.payload.result.corpusPlan.inputDocumentPlan.manifests[0].format, "jsonl");
    const manifestMarkdown = manifestRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "manifest-md");
    const manifestCsv = manifestRun.payload.result.corpusPlan.documents.find((document) => document.sourceId === "manifest-csv");
    assert.ok(manifestMarkdown, "manifest Markdown file-ref source must be present in corpus");
    assert.ok(manifestCsv, "manifest CSV file-ref source must be present in corpus");
    assert.equal(manifestMarkdown.quality.suppliedPayloadKind, "file-ref-stream");
    assert.equal(manifestMarkdown.windowPlan.strategy, "file-ref-stream-windowing.v1");
    assert.equal(manifestMarkdown.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
    assert.equal(manifestCsv.route.formatId, "spreadsheet");
    assert.equal(manifestCsv.quality.suppliedPayloadKind, "file-ref-stream");
    assert.equal(manifestRun.payload.result.agentMessage.corpusPlan.inputDocumentPlan.manifestDocumentCount, 2);
  }

  const contradictionRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "冲突证据门禁验证",
      title: "冲突证据门禁验证",
      workflowScope: "document",
      responseProfile: "agent",
      requestedClaims: [
        "Legacy FTP upload is permitted for production evidence."
      ],
      rawDocuments: [
        {
          sourceId: "conflict-policy",
          title: "Policy",
          fileName: "policy.md",
          mediaType: "text/markdown",
          text: "Legacy FTP upload is not permitted for production evidence. Use signed object storage instead."
        }
      ]
    })
  });
  assert.equal(contradictionRun.status, 201);
  assert.equal(contradictionRun.payload.status, "completed");
  const contradictedClaim = contradictionRun.payload.result.grounding.claims.find((claim) => claim.source === "requested-claim");
  assert.equal(contradictedClaim.status, "contradicted");
  assert.equal(contradictedClaim.conflictEvidence.length >= 1, true);
  assert.equal(contradictedClaim.evidenceRefs.length, 0);

  const incrementalFirstRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      projectId: "incremental-project-alpha",
      query: "增量工程首次快照",
      title: "增量工程首次快照",
      workflowScope: "project",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "inc-architecture",
          title: "Incremental Architecture",
          fileName: "architecture.md",
          mediaType: "text/markdown",
          text: "The project API gateway supports signed object storage and parser routing."
        },
        {
          sourceId: "inc-finance",
          title: "Incremental Finance",
          fileName: "finance.csv",
          mediaType: "text/csv",
          text: "vendor,total,payment_date\nAlpha,100,2026-06-01"
        }
      ]
    })
  });
  assert.equal(incrementalFirstRun.status, 201);
  assert.equal(incrementalFirstRun.payload.result.incrementalPlan.mode, "full-snapshot");
  assert.equal(incrementalFirstRun.payload.result.incrementalPlan.addedSourceIds.includes("inc-architecture"), true);
  assert.equal(incrementalFirstRun.payload.result.incrementalPlan.snapshot.projectId, "incremental-project-alpha");

  const incrementalSecondRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      projectId: "incremental-project-alpha",
      query: "增量工程变更快照",
      title: "增量工程变更快照",
      workflowScope: "project",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "inc-architecture",
          title: "Incremental Architecture",
          fileName: "architecture.md",
          mediaType: "text/markdown",
          text: "The project API gateway supports signed object storage and parser routing."
        },
        {
          sourceId: "inc-finance",
          title: "Incremental Finance",
          fileName: "finance.csv",
          mediaType: "text/csv",
          text: "vendor,total,payment_date\nAlpha,140,2026-06-15"
        }
      ]
    })
  });
  assert.equal(incrementalSecondRun.status, 201);
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.mode, "incremental");
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.previousRunId, incrementalFirstRun.payload.runId);
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.reusedSourceIds.includes("inc-architecture"), true);
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.changedSourceIds.includes("inc-finance"), true);
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.reusedWindowCount >= 1, true);
  assert.equal(incrementalSecondRun.payload.result.agentMessage.incrementalPlan.reuseRatio > 0, true);
  const snapshotArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(incrementalSecondRun.payload.runId)}/artifacts/project-snapshot-json`, {
    headers: authHeaders(auth)
  });
  assert.equal(snapshotArtifact.status, 200);
  assert.match(snapshotArtifact.headers.get("content-type") || "", /application\/json/);
  const snapshotPayload = JSON.parse(await snapshotArtifact.text());
  assert.equal(snapshotPayload.projectId, "incremental-project-alpha");
  assert.equal(snapshotPayload.previousRunId, incrementalFirstRun.payload.runId);
  assert.equal(snapshotPayload.snapshot.documents.some((document) => document.sourceId === "inc-finance"), true);

  const projectEvidence = await fetchJson(
    `${pactServer.url}/api/external/knowledge/distillation/projects/incremental-project-alpha/evidence?mode=all&runLimit=10&sourceId=inc-finance&timeFrom=2026-06-01&timeTo=2026-06-30&limit=50`,
    { headers: authHeaders(auth) }
  );
  assert.equal(projectEvidence.status, 200);
  assert.equal(projectEvidence.payload.strategy, "project-graph-evidence-convergence-query.v1");
  assert.equal(projectEvidence.payload.evidenceQueryStrategy, "graph-lite-evidence-query.v1");
  assert.equal(projectEvidence.payload.projectId, "incremental-project-alpha");
  assert.equal(projectEvidence.payload.matchedRunCount >= 2, true);
  assert.equal(projectEvidence.payload.runIds.includes(incrementalFirstRun.payload.runId), true);
  assert.equal(projectEvidence.payload.runIds.includes(incrementalSecondRun.payload.runId), true);
  assert.equal(projectEvidence.payload.text_units.length > 0, true);
  assert.equal(projectEvidence.payload.text_units.every((textUnit) => textUnit.sourceRunId), true);
  assert.equal(projectEvidence.payload.text_units.every((textUnit) => textUnit.sourceId === "inc-finance"), true);
  assert.equal(projectEvidence.payload.counts.original.text_units >= projectEvidence.payload.counts.returned.text_units, true);
  assert.equal(projectEvidence.payload.filters.domain, "");

  const timeFilteredRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "时间过滤蒸馏验证",
      title: "时间过滤蒸馏验证",
      workflowScope: "corpus",
      responseProfile: "agent",
      timeFilter: {
        from: "2026-06-01",
        to: "2026-06-30",
        timeField: "eventTime",
        confidenceMin: 0.9,
        excludeWeakEvidence: true
      },
      rawDocuments: [
        {
          sourceId: "time-may",
          title: "May Payment",
          fileName: "may-payment.csv",
          mediaType: "text/csv",
          contentBase64: base64Text("vendor,total,payment_date\nMayCo,10,2026-05-31")
        },
        {
          sourceId: "time-june",
          title: "June Payment",
          fileName: "june-payment.csv",
          mediaType: "text/csv",
          contentBase64: base64Text("vendor,total,payment_date\nJuneCo,20,2026-06-15")
        },
        {
          sourceId: "time-undated",
          title: "Undated Note",
          fileName: "undated.md",
          mediaType: "text/markdown",
          text: "# Undated\nThis note should be excluded by strict time filtering."
        }
      ]
    })
  });
  assert.equal(timeFilteredRun.status, 201);
  assert.equal(timeFilteredRun.payload.status, "completed");
  assert.equal(timeFilteredRun.payload.result.corpusPlan.timeFilter.active, true);
  assert.equal(timeFilteredRun.payload.result.corpusPlan.timeFilter.matchedSourceIds.includes("time-june"), true);
  assert.equal(timeFilteredRun.payload.result.corpusPlan.timeFilter.filteredOutSourceIds.includes("time-may"), true);
  assert.equal(timeFilteredRun.payload.result.corpusPlan.timeFilter.filteredOutSourceIds.includes("time-undated"), true);
  assert.deepEqual(timeFilteredRun.payload.result.corpusPlan.documents.map((document) => document.sourceId), ["time-june"]);
  assert.equal(timeFilteredRun.payload.result.corpusPlan.documents[0].timeRange.from, "2026-06-15");
  assert.equal(timeFilteredRun.payload.result.corpusPlan.documents[0].windowPlan.windows.every((window) => window.timeRange?.from === "2026-06-15"), true);
  assert.equal(timeFilteredRun.payload.result.candidates.every((candidate) => candidate.sourceIds.includes("time-june")), true);
  assert.equal(timeFilteredRun.payload.result.candidates.some((candidate) => candidate.sourceIds.includes("time-may")), false);
  assert.equal(timeFilteredRun.payload.result.agentMessage.corpusPlan.timeFilter.matchedSourceIds.includes("time-june"), true);

  const failedRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "空语料失败验证",
      title: "空语料失败验证",
      workflowScope: "document",
      rawDocuments: [
        {
          sourceId: "image-only",
          title: "Image Only",
          fileName: "image-only.png",
          mediaType: "image/png",
          contentBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")
        }
      ],
      responseProfile: "agent"
    })
  });
  assert.equal(failedRun.status, 201);
  assert.equal(failedRun.payload.status, "failed");
  assert.equal(failedRun.payload.result.errors[0].code, "EMPTY_RAW_CORPUS");
  assert.equal(failedRun.payload.result.agentMessage.errors[0].code, "EMPTY_RAW_CORPUS");
  const imageTrace = failedRun.payload.result.corpusPlan.documents[0].parserTrace;
  assert.equal(imageTrace.some((trace) => trace.stage === "ocr.image" && ["unavailable", "available-not-executed"].includes(trace.status)), true);
  assert.equal(failedRun.payload.result.runtimeStatus.summary.ocrAvailable, Boolean(
    failedRun.payload.result.runtimeStatus.runtimes["ocr.tesseract"].available ||
    failedRun.payload.result.runtimeStatus.runtimes["ocr.paddleocr"].available
  ));

  const scannedPdfRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "扫描 PDF 降级验证",
      title: "扫描 PDF 降级验证",
      workflowScope: "document",
      rawDocuments: [
        {
          sourceId: "scanned-pdf",
          title: "Scanned PDF",
          fileName: "scanned.pdf",
          mediaType: "application/pdf",
          contentBase64: base64Text("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF")
        }
      ],
      responseProfile: "agent"
    })
  });
  assert.equal(scannedPdfRun.status, 201);
  assert.equal(scannedPdfRun.payload.status, "failed");
  const scannedTrace = scannedPdfRun.payload.result.corpusPlan.documents[0].parserTrace;
  const scannedPdfCorpus = scannedPdfRun.payload.result.corpusPlan.documents[0];
  assert.equal(scannedPdfCorpus.pdfProfile.strategy, "pdf-subtype-routing.v1");
  assert.equal(scannedPdfCorpus.pdfProfile.subtype, "pdf-empty-or-unknown");
  assert.equal(scannedPdfCorpus.route.pdfSubtype, "pdf-empty-or-unknown");
  assert.equal(scannedTrace.some((trace) => trace.stage === "pdf.subtype-route" && trace.subtype === "pdf-empty-or-unknown"), true);
  assert.equal(scannedTrace.some((trace) => trace.stage === "pdf.text.basic" && trace.status === "empty"), true);
  assert.equal(scannedTrace.some((trace) => trace.stage === "pdf.visual.layout" && ["unavailable", "available-not-executed"].includes(trace.status)), true);
  assert.equal(scannedTrace.some((trace) => trace.stage === "ocr.page" && ["unavailable", "available-not-executed"].includes(trace.status)), true);

  const fontRiskPdfRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      query: "PDF 字体映射风险验证",
      title: "PDF 字体映射风险验证",
      workflowScope: "document",
      rawDocuments: [
        {
          sourceId: "font-risk-pdf",
          title: "Font Risk PDF",
          fileName: "font-risk.pdf",
          mediaType: "application/pdf",
          contentBase64: base64Text([
            "%PDF-1.4",
            "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
            "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
            "3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
            "4 0 obj << /Type /Font /Subtype /TrueType /BaseFont /BrokenFont >> endobj",
            "5 0 obj << /Length 0 >> stream",
            "",
            "endstream",
            "endobj",
            "trailer << /Root 1 0 R >>",
            "%%EOF"
          ].join("\n"))
        }
      ],
      responseProfile: "agent"
    })
  });
  assert.equal(fontRiskPdfRun.status, 201);
  assert.equal(fontRiskPdfRun.payload.status, "failed");
  const fontRiskPdf = fontRiskPdfRun.payload.result.corpusPlan.documents[0];
  assert.equal(fontRiskPdf.pdfProfile.strategy, "pdf-subtype-routing.v1");
  assert.equal(fontRiskPdf.pdfProfile.subtype, "pdf-font-broken");
  assert.equal(fontRiskPdf.route.pdfSubtype, "pdf-font-broken");
  assert.equal(fontRiskPdf.route.riskFlags.includes("font-mapping-risk"), true);
  assert.equal(fontRiskPdf.parserTrace.some((trace) => trace.stage === "pdf.subtype-route" && trace.subtype === "pdf-font-broken"), true);

  const getRun = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}`, {
    headers: authHeaders(auth)
  });
  assert.equal(getRun.status, 200);
  assert.equal(getRun.payload.runId, createRun.payload.runId);

  const invoiceEvidence = await fetchJson(
    `${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/evidence?entity=invoice&sourceId=source-2&limit=20`,
    { headers: authHeaders(auth) }
  );
  assert.equal(invoiceEvidence.status, 200);
  assert.equal(invoiceEvidence.payload.strategy, "graph-lite-evidence-query.v1");
  assert.equal(invoiceEvidence.payload.filters.entity, "invoice");
  assert.equal(invoiceEvidence.payload.filters.sourceId, "source-2");
  assert.equal(invoiceEvidence.payload.text_units.length > 0, true);
  assert.equal(invoiceEvidence.payload.entities.some((entity) => /invoice/i.test(entity.title)), true);
  assert.equal(invoiceEvidence.payload.counts.returned.text_units <= 20, true);

  const docsDomainEvidence = await fetchJson(
    `${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/evidence?domain=docs&routeId=markdown&limit=20`,
    { headers: authHeaders(auth) }
  );
  assert.equal(docsDomainEvidence.status, 200);
  assert.equal(docsDomainEvidence.payload.filters.domain, "docs");
  assert.equal(docsDomainEvidence.payload.filters.routeId, "markdown");
  assert.equal(docsDomainEvidence.payload.text_units.some((textUnit) => (
    textUnit.metadata?.projectDomain === "docs" &&
    textUnit.metadata?.routeId === "markdown"
  )), true);

  const claimEvidence = await fetchJson(
    `${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/evidence?claimStatus=TRUE&claim=external.knowledge.distillation&limit=20`,
    { headers: authHeaders(auth) }
  );
  assert.equal(claimEvidence.status, 200);
  assert.equal(claimEvidence.payload.strategy, "graph-lite-evidence-query.v1");
  assert.equal(claimEvidence.payload.filters.claimStatus, "TRUE");
  assert.equal(claimEvidence.payload.covariates.length > 0, true);
  assert.equal(claimEvidence.payload.covariates.every((claim) => claim.status === "TRUE"), true);

  const listRuns = await fetchJson(`${pactServer.url}/api/external/knowledge/distillation/runs?limit=20`, {
    headers: authHeaders(auth)
  });
  assert.equal(listRuns.status, 200);
  assert.equal(listRuns.payload.runs.some((run) => run.runId === createRun.payload.runId), true);

  const artifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/portable-markdown`, {
    headers: authHeaders(auth)
  });
  assert.equal(artifact.status, 200);
  assert.match(artifact.headers.get("content-type") || "", /text\/markdown/);
  assert.equal(artifact.headers.get("x-pact-external-service"), "external.knowledge.distillation");
  assert.equal(Number(artifact.headers.get("x-pact-external-service-transfer-bytes") || 0) > 0, true);
  assert.equal(Number(artifact.headers.get("x-pact-external-service-bytes-per-second") || 0) >= 0, true);
  const markdown = await artifact.text();
  assert.match(markdown, /external\.knowledge\.distillation/);
  assert.match(markdown, /Source Routing/);
  assert.match(markdown, /Category Distillations/);
  assert.match(markdown, /Project Convergence/);
  assert.match(markdown, /Incremental Plan/);
  assert.match(markdown, /Graph Evidence/);

  const docxArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/portable-docx`, {
    headers: authHeaders(auth)
  });
  assert.equal(docxArtifact.status, 200);
  assert.match(docxArtifact.headers.get("content-type") || "", /officedocument\.wordprocessingml\.document/);
  const docxEntries = unzipSync(new Uint8Array(await docxArtifact.arrayBuffer()));
  assert.ok(docxEntries["[Content_Types].xml"], "DOCX must include OpenXML content types");
  assert.ok(docxEntries["word/document.xml"], "DOCX must include word/document.xml");
  const docxDocumentXml = Buffer.from(docxEntries["word/document.xml"]).toString("utf8");
  const docxRelationshipsXml = Buffer.from(docxEntries["word/_rels/document.xml.rels"]).toString("utf8");
  const docxStylesXml = Buffer.from(docxEntries["word/styles.xml"]).toString("utf8");
  assert.match(docxDocumentXml, /External Knowledge Distillation|Category Distillations/);
  assert.match(docxDocumentXml, /w:pStyle w:val="Heading1"/, "DOCX export must render Markdown headings as Word heading styles");
  assert.match(docxDocumentXml, /w:pStyle w:val="ListParagraph"/, "DOCX export must render Markdown bullets as Word list paragraphs");
  assert.match(docxDocumentXml, /<w:tbl\b/, "DOCX export must render Markdown source-routing tables as Word tables");
  assert.match(docxDocumentXml, /<w:hyperlink\b/, "DOCX export must preserve Markdown hyperlinks as OpenXML hyperlinks");
  assert.match(docxRelationshipsXml, /relationships\/hyperlink/, "DOCX export must register hyperlink relationships");
  assert.match(docxRelationshipsXml, /https:\/\/example\.test\/agent/, "DOCX hyperlink relationship must preserve the original target");
  assert.match(docxStylesXml, /w:styleId="CodeBlock"/, "DOCX export must declare a code block style for Markdown code conversion");

  const consoleSummaryArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/console-summary-json`, {
    headers: authHeaders(auth)
  });
  assert.equal(consoleSummaryArtifact.status, 200);
  assert.match(consoleSummaryArtifact.headers.get("content-type") || "", /application\/json/);
  const consoleSummary = JSON.parse(await consoleSummaryArtifact.text());
  assert.equal(consoleSummary.responseProfile, "console");
  assert.equal(consoleSummary.modeSeparation.strategy, "human-agent-response-profile-separation.v1");
  assert.equal(consoleSummary.modeSeparation.humanReadable.artifacts.includes("portable-docx"), true);
  assert.equal(consoleSummary.modeSeparation.agentReadable.artifacts.includes("professional-format-manifest-json"), true);
  assert.equal(consoleSummary.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.openability?.docxOpenXmlPackage === true &&
    document.qualityGateStatusCounts?.passed >= 1
  )), true);
  assert.equal(consoleSummary.documents.every((document) => !Object.prototype.hasOwnProperty.call(document, "parserTrace")), true);
  assert.equal(consoleSummary.omittedForConsole.includes("parserTrace"), true);

  const agentArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/agent-message-json`, {
    headers: authHeaders(auth)
  });
  assert.equal(agentArtifact.status, 200);
  assert.match(agentArtifact.headers.get("content-type") || "", /application\/json/);
  const agentMessage = JSON.parse(await agentArtifact.text());
  assert.equal(agentMessage.responseProfile, "agent");
  assert.ok(agentMessage.classification.groupCount >= 2);
  assert.equal(agentMessage.routePlan.strategy, "content-signature-extension-media-shape-routing.v2");
  assert.equal(agentMessage.routePlan.documents.some((document) => (
    document.sourceId === "source-45" &&
    document.formatId === "word" &&
    document.contentSignature === "zip-ooxml-word"
  )), true);
  assert.equal(agentMessage.corpusPlan.allSizePolicy, "streaming-windowed");
  assert.equal(agentMessage.incrementalPlan.strategy, "project-snapshot-incremental-convergence.v1");
  assert.equal(agentMessage.graphEvidence.strategy, "graph-lite-entity-relationship-evidence-pack.v1");
  assert.equal(agentMessage.formatConversionPlan.strategy, "office-document-professional-adaptation.v1");
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithCellRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithPdfOutlineRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithPdfFormFieldRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithPresentationInheritanceRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithPresentationLayoutRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithPresentationMasterRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithPresentationCommentRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithSpreadsheetCommentRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithRevisionRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithFrontmatterRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithCodeBlockRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithBlockquoteRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithContentControlRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithBookmarkRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithHeaderFooterRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithDefinedNameRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithNamedRangeRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithPrintAreaRefsCount >= 1, true);
  assert.equal(agentMessage.formatConversionPlan.summary.documentWithChartRefsCount >= 1, true);
  assert.equal(agentMessage.graphEvidence.summary.entityCount > 0, true);
  assert.equal(agentMessage.classification.communityCount >= agentMessage.classification.coreGroupCount, true);
  assert.equal(agentMessage.classification.groups.some((group) => group.distillationUnit?.mode === "topic-isolated"), true);
  assert.equal(agentMessage.convergence.strategy, "hierarchical-domain-topic-project-convergence.v3");
  assert.equal(agentMessage.convergence.agentQueryIndex.dimensions.includes("projectDomain"), true);
  assert.equal(agentMessage.outputs.every((output) => output.promotionGate.promoted), true);
  assert.equal(agentMessage.grounding.strategy, "claim-evidence-topk-conflict-gating.v2");
  const evidenceArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/evidence-pack-json`, {
    headers: authHeaders(auth)
  });
  assert.equal(evidenceArtifact.status, 200);
  assert.match(evidenceArtifact.headers.get("content-type") || "", /application\/json/);
  const evidencePack = JSON.parse(await evidenceArtifact.text());
  assert.equal(evidencePack.strategy, "graph-lite-entity-relationship-evidence-pack.v1");
  assert.equal(evidencePack.text_units.length >= createRun.payload.result.corpusPlan.windowCount, true);
  assert.equal(evidencePack.entities.length > 0, true);
  assert.equal(evidencePack.relationships.length > 0, true);
  assert.equal(evidencePack.communities.length >= createRun.payload.result.classification.groupCount, true);
  const conversionArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/format-conversion-plan-json`, {
    headers: authHeaders(auth)
  });
  assert.equal(conversionArtifact.status, 200);
  assert.match(conversionArtifact.headers.get("content-type") || "", /application\/json/);
  const conversionPlan = JSON.parse(await conversionArtifact.text());
  assert.equal(conversionPlan.strategy, "office-document-professional-adaptation.v1");
  assert.equal(conversionPlan.summary.documentWithCellRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithFormulaRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithLinkRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithSheetRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithCodeBlockRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithBlockquoteRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithDefinedNameRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithNamedRangeRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithPrintAreaRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithDateCellRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithMergedCellRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithPdfOutlineRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithPdfFormFieldRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithPresentationInheritanceRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithPresentationLayoutRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithPresentationMasterRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithPresentationCommentRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithSpreadsheetCommentRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithImageRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithChartRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithChartSeriesRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithStyleRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithNumberingRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithContentControlRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithBookmarkRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithHeaderFooterRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithAnnotationsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithRevisionRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithFrontmatterRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.outputArtifactFailedCount, 0);
  assert.equal(conversionPlan.outputArtifactValidation.artifacts.every((artifact) => artifact.status === "passed"), true);
  assert.equal(conversionPlan.outputArtifactValidation.artifacts.some((artifact) => (
    artifact.artifactId === "portable-docx" &&
    artifact.gates.some((gate) => gate.gate === "word-heading-styles-present" && gate.status === "passed") &&
    artifact.gates.some((gate) => gate.gate === "word-list-and-code-styles-present" && gate.status === "passed") &&
    artifact.gates.some((gate) => gate.gate === "word-table-elements-well-formed" && gate.status === "passed") &&
    artifact.gates.some((gate) => gate.gate === "word-hyperlinks-well-formed" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.formatMatrix.some((item) => item.routeId === "pdf" && item.qualityGates.includes("page-order-preserved")), true);
  assert.equal(conversionPlan.formatMatrix.some((item) => item.routeId === "pdf" && item.qualityGates.includes("pdf-link-refs-preserved")), true);
  assert.equal(conversionPlan.formatMatrix.some((item) => item.routeId === "pdf" && item.qualityGates.includes("pdf-outline-refs-preserved")), true);
  assert.equal(conversionPlan.formatMatrix.some((item) => item.routeId === "pdf" && item.qualityGates.includes("pdf-form-fields-preserved")), true);
  assert.equal(conversionPlan.formatMatrix.some((item) => item.routeId === "presentation" && item.qualityGates.includes("presentation-layout-master-refs-preserved")), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "pdf" &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.pdfOutlineRefCount >= 2 &&
    document.evidence.pdfFormFieldRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-outline-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-form-fields-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => document.routeId === "spreadsheet" && document.evidence.cellRefCount >= 1), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.evidence.sheetRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-workbook-sheet-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.evidence.definedNameRefCount >= 2 &&
    document.evidence.namedRangeRefCount >= 1 &&
    document.evidence.printAreaRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-defined-name-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.evidence.mergeRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-merged-cell-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.evidence.spreadsheetCommentRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-comment-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.evidence.dateCellRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-date-serials-normalized" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.qualityGateResults.some((gate) => gate.gate === "formula-text-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.evidence.hyperlinkRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-hyperlink-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.evidence.chartRefCount >= 1 &&
    document.evidence.chartSeriesRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-chart-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "word" &&
    document.evidence.annotationElementCount >= 1 &&
    document.evidence.styleRefCount >= 1 &&
    document.evidence.numberingRefCount >= 1 &&
    document.evidence.contentControlRefCount >= 1 &&
    document.evidence.bookmarkRefCount >= 1 &&
    document.evidence.headerFooterRefCount >= 2 &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.chartRefCount >= 1 &&
    document.evidence.revisionRefCount >= 2 &&
    document.qualityGateResults.some((gate) => gate.gate === "word-paragraph-style-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-list-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-content-control-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-bookmark-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-header-footer-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-image-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-chart-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-revision-refs-preserved" && gate.status === "passed") &&
    document.conversionAdapters.some((adapter) => adapter.adapter === "word-elements-to-valid-openxml.v1")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "presentation" &&
    document.evidence.placeholderRefCount >= 2 &&
    document.evidence.shapeRefCount >= 2 &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.imageRefCount >= 1 &&
    document.evidence.chartRefCount >= 1 &&
    document.evidence.presentationLayoutRefCount >= 1 &&
    document.evidence.presentationMasterRefCount >= 1 &&
    document.evidence.speakerNoteElementCount >= 1 &&
    document.evidence.presentationCommentRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-layout-master-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-placeholder-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-image-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-chart-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-speaker-notes-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-comment-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "markdown" &&
    document.parserStages.includes("markdown.frontmatter") &&
    document.preserves.includes("frontmatter") &&
    document.preserves.includes("codeBlocks") &&
    document.preserves.includes("blockquotes") &&
    document.evidence.frontmatterRefCount >= 3 &&
    document.evidence.codeBlockRefCount >= 1 &&
    document.evidence.blockquoteRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-frontmatter-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-code-blocks-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-blockquote-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "open-document" &&
    document.evidence.linkElementCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "opendocument-link-refs-preserved" && gate.status === "passed")
  )), true);
  const professionalManifestArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/professional-format-manifest-json`, {
    headers: authHeaders(auth)
  });
  assert.equal(professionalManifestArtifact.status, 200);
  assert.match(professionalManifestArtifact.headers.get("content-type") || "", /application\/json/);
  const professionalManifest = JSON.parse(await professionalManifestArtifact.text());
  assert.equal(professionalManifest.strategy, "professional-format-manifest.v1");
  assert.equal(professionalManifest.modeSeparation.strategy, "human-agent-response-profile-separation.v1");
  assert.equal(professionalManifest.modeSeparation.agentReadable.artifacts.includes("agent-message-json"), true);
  assert.equal(professionalManifest.documents.some((document) => (
    document.routeId === "pdf" &&
    document.parserProfile === "pdf.text-layout-ocr-route" &&
    document.parserStages.includes("pdf.outlines") &&
    document.parserStages.includes("pdf.form-fields") &&
    document.preserves.includes("outline") &&
    document.preserves.includes("formFields") &&
    document.evidence.pdfOutlineRefCount >= 2 &&
    document.evidence.pdfFormFieldRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-outline-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-form-fields-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalManifest.documents.some((document) => (
    document.routeId === "word" &&
    document.parserProfile === "wordprocessingml-paragraph-style-route" &&
    document.parserStages.includes("office.word.styles") &&
    document.parserStages.includes("office.word.numbering") &&
    document.parserStages.includes("office.word.content-controls") &&
    document.parserStages.includes("office.word.bookmarks") &&
    document.parserStages.includes("office.word.headers-footers") &&
    document.parserStages.includes("office.word.revisions") &&
    document.parserStages.includes("office.word.hyperlinks") &&
    document.parserStages.includes("office.word.images") &&
    document.parserStages.includes("office.word.charts") &&
    document.preserves.includes("paragraphStyles") &&
    document.preserves.includes("listLevels") &&
    document.preserves.includes("contentControls") &&
    document.preserves.includes("bookmarks") &&
    document.preserves.includes("headers") &&
    document.preserves.includes("footers") &&
    document.preserves.includes("links") &&
    document.preserves.includes("images") &&
    document.preserves.includes("charts") &&
    document.preserves.includes("comments") &&
    document.preserves.includes("revisions") &&
    document.evidence.styleRefCount >= 1 &&
    document.evidence.numberingRefCount >= 1 &&
    document.evidence.contentControlRefCount >= 1 &&
    document.evidence.bookmarkRefCount >= 1 &&
    document.evidence.headerFooterRefCount >= 2 &&
    document.evidence.imageRefCount >= 1 &&
    document.evidence.chartRefCount >= 1 &&
    document.evidence.revisionRefCount >= 2 &&
    document.qualityGateResults.some((gate) => gate.gate === "word-paragraph-style-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-list-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-content-control-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-bookmark-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-header-footer-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-image-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-chart-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-annotation-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "word-revision-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalManifest.documents.some((document) => (
    document.routeId === "presentation" &&
    document.parserStages.includes("office.presentation.slides") &&
    document.parserStages.includes("office.presentation.layouts") &&
    document.parserStages.includes("office.presentation.placeholders") &&
    document.parserStages.includes("office.presentation.hyperlinks") &&
    document.parserStages.includes("office.presentation.images") &&
    document.parserStages.includes("office.presentation.charts") &&
    document.parserStages.includes("office.presentation.speaker-notes") &&
    document.parserStages.includes("office.presentation.comments") &&
    document.preserves.includes("shape-placeholder") &&
    document.preserves.includes("shape-bbox") &&
    document.preserves.includes("slide-layout") &&
    document.preserves.includes("slide-master") &&
    document.preserves.includes("links") &&
    document.preserves.includes("images") &&
    document.preserves.includes("charts") &&
    document.preserves.includes("speaker-notes") &&
    document.preserves.includes("comments") &&
    document.evidence.placeholderRefCount >= 2 &&
    document.evidence.presentationLayoutRefCount >= 1 &&
    document.evidence.presentationMasterRefCount >= 1 &&
    document.evidence.imageRefCount >= 1 &&
    document.evidence.chartRefCount >= 1 &&
    document.evidence.presentationCommentRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-layout-master-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-placeholder-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-image-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-chart-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-speaker-notes-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-comment-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalManifest.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.parserStages.includes("table.workbook.sheets") &&
    document.parserStages.includes("table.workbook.defined-names") &&
    document.parserStages.includes("table.sheet.merged-cells") &&
    document.parserStages.includes("table.sheet.comments") &&
    document.parserStages.includes("table.sheet.date-styles") &&
    document.parserStages.includes("table.sheet.formulas") &&
    document.parserStages.includes("table.sheet.hyperlinks") &&
    document.parserStages.includes("table.sheet.charts") &&
    document.preserves.includes("sheetName") &&
    document.preserves.includes("sheetId") &&
    document.preserves.includes("definedNames") &&
    document.preserves.includes("namedRanges") &&
    document.preserves.includes("printAreas") &&
    document.preserves.includes("mergedCells") &&
    document.preserves.includes("cellComments") &&
    document.preserves.includes("dateSerials") &&
    document.preserves.includes("hyperlinks") &&
    document.preserves.includes("charts") &&
    document.evidence.sheetRefCount >= 1 &&
    document.evidence.definedNameRefCount >= 2 &&
    document.evidence.namedRangeRefCount >= 1 &&
    document.evidence.printAreaRefCount >= 1 &&
    document.evidence.mergeRefCount >= 1 &&
    document.evidence.spreadsheetCommentRefCount >= 1 &&
    document.evidence.dateCellRefCount >= 1 &&
    document.evidence.formulaRefCount >= 1 &&
    document.evidence.chartRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-workbook-sheet-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-defined-name-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-merged-cell-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-comment-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-date-serials-normalized" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-chart-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalManifest.documents.some((document) => (
    document.routeId === "markdown" &&
    document.parserProfile === "markdown-block-element-route" &&
    document.parserStages.includes("markdown.frontmatter") &&
    document.preserves.includes("frontmatter") &&
    document.preserves.includes("codeBlocks") &&
    document.preserves.includes("blockquotes") &&
    document.evidence.frontmatterRefCount >= 3 &&
    document.evidence.codeBlockRefCount >= 1 &&
    document.evidence.blockquoteRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-frontmatter-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-code-blocks-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-blockquote-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(professionalManifest.documents.some((document) => (
    document.routeId === "open-document" &&
    document.parserStages.includes("open-document.hyperlinks") &&
    document.preserves.includes("links") &&
    document.evidence.linkElementCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "opendocument-link-refs-preserved" && gate.status === "passed")
  )), true);
  const referenceGapArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/reference-gap-report-json`, {
    headers: authHeaders(auth)
  });
  assert.equal(referenceGapArtifact.status, 200);
  const referenceGapReport = JSON.parse(await referenceGapArtifact.text());
  assert.equal(referenceGapReport.strategy, "reference-framework-gap-report.v1");
  assert.equal(referenceGapReport.frameworks.some((framework) => framework.id === "docling" && framework.openGaps.length > 0), true);

  const workspacePackageArtifact = await fetch(`${pactServer.url}/api/external/knowledge/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/workspace-package-zip`, {
    headers: authHeaders(auth)
  });
  assert.equal(workspacePackageArtifact.status, 200);
  assert.match(workspacePackageArtifact.headers.get("content-type") || "", /application\/zip/);
  const workspaceEntries = unzipSync(new Uint8Array(await workspacePackageArtifact.arrayBuffer()));
  for (const entryName of ["manifest.json", "distillation.md", "distillation.docx", "console-summary.json", "agent-message.json", "result.json", "project-snapshot.json", "evidence-pack.json", "format-conversion-plan.json", "professional-format-manifest.json", "reference-gap-report.json"]) {
    assert.ok(workspaceEntries[entryName], `workspace package must include ${entryName}`);
  }
  const workspaceManifest = JSON.parse(Buffer.from(workspaceEntries["manifest.json"]).toString("utf8"));
  assert.equal(workspaceManifest.protocolVersion, "pact.external-knowledge-distillation.v1.workspace-package");
  assert.equal(workspaceManifest.artifacts.every((item) => item.byteSize > 0 && /^[a-f0-9]{64}$/.test(item.sha256)), true);
  assert.equal(workspaceManifest.artifacts.some((item) => (
    item.artifactId === "portable-docx" &&
    item.validation?.status === "passed" &&
    item.validation.gates.some((gate) => gate.gate === "word-document-body-present" && gate.status === "passed") &&
    item.validation.gates.some((gate) => gate.gate === "word-heading-styles-present" && gate.status === "passed")
  )), true);
} finally {
  if (pactServer) {
    await pactServer.close();
  }
  await service.close();
  if (previousUrl === undefined) {
    delete process.env.PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL;
  } else {
    process.env.PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL = previousUrl;
  }
  if (serviceDataDir) {
    await fs.rm(serviceDataDir, { recursive: true, force: true });
  }
  await fs.rm(pactDataDir, { recursive: true, force: true });
}

console.log("external knowledge distillation registration verification passed");
