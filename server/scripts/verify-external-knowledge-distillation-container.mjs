import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { strToU8, unzipSync, zipSync } from "fflate";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serviceDir = path.join(repoRoot, "external-services/knowledge-distillation-service");
const imageTag = process.env.PACT_EXTERNAL_KD_IMAGE || "pact-external-knowledge-distillation:local";
const containerName = `pact-external-kd-verify-${process.pid}-${Date.now()}`;

const FONT_5X7 = Object.freeze({
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"]
});

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

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${code}\n${stdout}\n${stderr}`.trim()));
    });
  });
}

async function docker(args = []) {
  return run("docker", args);
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

async function waitForService(url, timeoutMs = 20_000) {
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Containerized external distillation service did not become healthy: ${lastError?.message || "timeout"}`);
}

function drawOcrRaster(lines = []) {
  const scale = 10;
  const glyphWidth = 5;
  const glyphHeight = 7;
  const glyphGap = 2;
  const lineGap = 3;
  const margin = 6;
  const normalizedLines = lines.map((line) => String(line || "").toUpperCase());
  const widest = normalizedLines.reduce((max, line) => Math.max(max, line.length), 1);
  const widthUnits = (margin * 2) + (widest * glyphWidth) + (Math.max(0, widest - 1) * glyphGap);
  const heightUnits = (margin * 2) + (normalizedLines.length * glyphHeight) + (Math.max(0, normalizedLines.length - 1) * lineGap);
  const width = widthUnits * scale;
  const height = heightUnits * scale;
  const pixels = Buffer.alloc(width * height, 255);
  const setBlock = (unitX, unitY) => {
    const startX = unitX * scale;
    const startY = unitY * scale;
    for (let y = startY; y < startY + scale; y += 1) {
      for (let x = startX; x < startX + scale; x += 1) {
        pixels[(y * width) + x] = 0;
      }
    }
  };
  normalizedLines.forEach((line, lineIndex) => {
    const yBase = margin + (lineIndex * (glyphHeight + lineGap));
    Array.from(line).forEach((character, charIndex) => {
      const glyph = FONT_5X7[character] || FONT_5X7[" "];
      const xBase = margin + (charIndex * (glyphWidth + glyphGap));
      glyph.forEach((row, rowIndex) => {
        Array.from(row).forEach((bit, colIndex) => {
          if (bit === "1") {
            setBlock(xBase + colIndex, yBase + rowIndex);
          }
        });
      });
    });
  });
  return { width, height, pixels };
}

function drawOcrPgm(lines = []) {
  const raster = drawOcrRaster(lines);
  return {
    ...raster,
    buffer: Buffer.concat([Buffer.from(`P5\n${raster.width} ${raster.height}\n255\n`, "ascii"), raster.pixels])
  };
}

function pdfStreamObject(number, header, stream) {
  return Buffer.concat([
    Buffer.from(`${number} 0 obj\n${header}\nstream\n`, "ascii"),
    Buffer.from(stream),
    Buffer.from("\nendstream\nendobj\n", "ascii")
  ]);
}

function pdfTextObject(number, body) {
  return Buffer.from(`${number} 0 obj\n${body}\nendobj\n`, "ascii");
}

function buildImageOnlyPdf(raster) {
  const pageWidth = raster.width + 144;
  const pageHeight = raster.height + 144;
  const content = Buffer.from(`q\n${raster.width} 0 0 ${raster.height} 72 72 cm\n/Im1 Do\nQ\n`, "ascii");
  const objects = [
    pdfTextObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfTextObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    pdfTextObject(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`
    ),
    pdfStreamObject(
      4,
      `<< /Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${raster.pixels.length} >>`,
      raster.pixels
    ),
    pdfStreamObject(5, `<< /Length ${content.length} >>`, content)
  ];
  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  for (const object of objects) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(object);
  }
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const xrefEntries = [
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
  ];
  chunks.push(Buffer.from([
    "xref",
    `0 ${objects.length + 1}`,
    ...xrefEntries,
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    ""
  ].join("\n"), "ascii"));
  return Buffer.concat(chunks);
}

function buildTextPdfWithLink() {
  const content = Buffer.from("BT /F1 12 Tf 72 720 Td (Container text PDF parser extracts linked evidence.) Tj ET", "ascii");
  const objects = [
    pdfTextObject(1, "<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /AcroForm 10 0 R >>"),
    pdfTextObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    pdfTextObject(
      3,
      "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R 11 0 R] >>"
    ),
    pdfTextObject(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    pdfStreamObject(5, `<< /Length ${content.length} >>`, content),
    pdfTextObject(6, "<< /Type /Annot /Subtype /Link /Rect [72 700 268 716] /Contents (Container PDF evidence portal) /A << /S /URI /URI (https://example.test/container-pdf-evidence) >> >>"),
    pdfTextObject(7, "<< /Type /Outlines /First 8 0 R /Last 9 0 R /Count 2 >>"),
    pdfTextObject(8, "<< /Title (Container PDF Overview) /Parent 7 0 R /Dest [3 0 R /Fit] /Next 9 0 R >>"),
    pdfTextObject(9, "<< /Title (Container PDF Evidence Appendix) /Parent 7 0 R /Dest [3 0 R /XYZ 72 720 0] >>"),
    pdfTextObject(10, "<< /Fields [11 0 R] >>"),
    pdfTextObject(11, "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Container Owner) /TU (Container owner field) /V (Runtime Team) /Rect [72 640 260 660] /P 3 0 R >>")
  ];
  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  for (const object of objects) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(object);
  }
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const xrefEntries = [
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
  ];
  chunks.push(Buffer.from([
    "xref",
    `0 ${objects.length + 1}`,
    ...xrefEntries,
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    ""
  ].join("\n"), "ascii"));
  return Buffer.concat(chunks);
}

function zipBase64(entries) {
  return Buffer.from(zipSync(Object.fromEntries(
    Object.entries(entries).map(([name, text]) => [name, typeof text === "string" ? strToU8(text) : text])
  ))).toString("base64");
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
    const data = Buffer.isBuffer(text) ? text : Buffer.from(String(text), "utf8");
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

function tarBase64(entries = {}) {
  return tarBuffer(entries).toString("base64");
}

function tgzBase64(entries = {}) {
  return gzipSync(tarBuffer(entries)).toString("base64");
}

function multipartEmailBase64({ boundary = "container-boundary", attachments = [] } = {}) {
  const lines = [
    "From: sender@example.test",
    "To: pact@example.test",
    "Subject: Container attachment routing",
    "Date: Sun, 31 May 2026 10:30:00 +0000",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Container email body includes project package attachment routing evidence."
  ];
  for (const attachment of attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mediaType}; name="${attachment.fileName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.fileName}"`,
      "",
      Buffer.from(attachment.bytes).toString("base64")
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64");
}

function mboxBase64() {
  const attachmentBase64 = Buffer.from("vendor,total\nContainerMboxCo,288", "utf8").toString("base64");
  return Buffer.from([
    "From analyst@example.test Sun May 31 10:00:00 2026",
    "From: analyst@example.test",
    "To: pact@example.test",
    "Subject: Container MBOX Architecture",
    "Date: Sun, 31 May 2026 10:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Container MBOX first message records parser routing evidence.",
    "From finance@example.test Sun May 31 10:05:00 2026",
    "From: finance@example.test",
    "To: pact@example.test",
    "Subject: Container MBOX Attachment",
    "Date: Sun, 31 May 2026 10:05:00 +0000",
    "Content-Type: multipart/mixed; boundary=\"container-mbox-boundary\"",
    "",
    "--container-mbox-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Container MBOX second message contains invoice attachment evidence.",
    "--container-mbox-boundary",
    "Content-Type: text/csv; name=\"container-mbox-invoice.csv\"",
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: attachment; filename=\"container-mbox-invoice.csv\"",
    "",
    attachmentBase64,
    "--container-mbox-boundary--",
    ""
  ].join("\r\n"), "utf8").toString("base64");
}

await docker(["version"]);

if (process.env.PACT_EXTERNAL_KD_SKIP_DOCKER_BUILD !== "1") {
  await docker(["build", "-t", imageTag, serviceDir]);
}

const port = await freePort();
const serviceUrl = `http://127.0.0.1:${port}`;
let started = false;

try {
  await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-p",
    `127.0.0.1:${port}:8799`,
    imageTag
  ]);
  started = true;

  await waitForService(serviceUrl);

  const runtime = await fetchJson(`${serviceUrl}/v1/runtime/health?refresh=1`);
  assert.equal(runtime.status, 200);
  assert.equal(runtime.payload.runtimes["tika.app"].available, true, "container must include runnable Tika app fallback");
  assert.equal(runtime.payload.runtimes["ocr.tesseract"].available, true, "container must include runnable Tesseract OCR");
  assert.equal(runtime.payload.runtimes["pdf.poppler"].available, true, "container must include runnable Poppler pdftoppm");
  assert.equal(runtime.payload.runtimes["pdf.pdftotext"].available, true, "container must include runnable Poppler pdftotext");
  assert.equal(runtime.payload.runtimes["archive.7zip"].available, true, "container must include runnable 7z archive extractor");
  assert.equal(runtime.payload.summary.ocrAvailable, true, "container runtime doctor must advertise OCR availability");

  const capabilities = await fetchJson(`${serviceUrl}/v1/capabilities`);
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.payload.classification.strategy, "hashing_embedding_window_community_classification_v3");
  assert.equal(capabilities.payload.classification.taxonomyStrategy, "semantic-concept-topic-hierarchy.v1");
  assert.equal(capabilities.payload.classification.assignmentRationaleStrategy, "leader-clustering-semantic-concept-rationale.v1");
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
  assert.equal(capabilities.payload.graphEvidence.projectQuery.supported, true);
  assert.equal(capabilities.payload.graphEvidence.projectQuery.strategy, "project-graph-evidence-convergence-query.v1");
  assert.equal(capabilities.payload.graphEvidence.query.filters.includes("domain"), true);
  assert.equal(capabilities.payload.graphEvidence.projectQuery.filters.includes("routeId"), true);
  assert.equal(capabilities.payload.graphEvidence.projectQuery.readModel, "domain-topic-community-source-time.v1");
  assert.equal(capabilities.payload.algorithms.includes("content-signature-routing.v1"), true);
  assert.equal(capabilities.payload.algorithms.includes("structured-json-file-ref-streaming-window.v1"), true);
  assert.equal(capabilities.payload.fileCompatibility.routingStrategy, "content-signature-extension-media-shape-routing.v2");
  assert.equal(capabilities.payload.fileCompatibility.routeOrder[0], "contentSignature");
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.strategy, "content-signature-routing.v1");
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("pdf-header"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("zip-ooxml-word"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("zip-ooxml-presentation"), true);
  assert.equal(capabilities.payload.fileCompatibility.contentSignatureRouting.signatures.includes("zip-ooxml-spreadsheet"), true);
  assert.equal(capabilities.payload.fileCompatibility.pdfSubtypeRouting.strategy, "pdf-subtype-routing.v1");
  assert.equal(capabilities.payload.fileCompatibility.pdfSubtypeRouting.subtypes.includes("pdf-scanned"), true);
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
  assert.equal(capabilities.payload.elementModel.supported, true);
  assert.equal(capabilities.payload.elementModel.strategy, "document-element-model.v1");
  assert.equal(capabilities.payload.elementModel.windowingStrategy, "element-aware-by-title-windowing.v1");
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("bbox"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("layout.width"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.ref"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.dateIso"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("cells.dateSerial"), true);
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
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("table.sheetName"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("definedName.ref"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("definedName.builtinType"), true);
  assert.equal(capabilities.payload.elementModel.geometryFields.includes("shape.placeholderType"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("pdf-outline"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("pdf-form-field"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("slide-shape"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("speaker-note"), true);
  assert.equal(capabilities.payload.elementModel.structuredFormats.includes("pdf"), true);
  assert.equal(capabilities.payload.elementModel.structuredFormats.includes("markdown"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("comment"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("revision"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("footnote"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("link"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("chart"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("content-control"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("bookmark"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("frontmatter"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("defined-name"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("merged-cell"), true);
  assert.equal(capabilities.payload.elementModel.elementTypes.includes("cell-comment"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.href"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.frontmatter"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.annotation"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.style.styleId"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.style.numberingId"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.shape.placeholderType"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.table.sheetName"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.image.target"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.image.relationshipId"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.chart.chartPart"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.chart.series"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.form.name"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.form.value"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.control.tag"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.bookmark.name"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.definedName.ref"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.definedName.builtinType"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.merge.ref"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.merge"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.comment"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.dateIso"), true);
  assert.equal(capabilities.payload.elementModel.graphMetadata.includes("elementRefs.cells.dateSerial"), true);
  assert.equal(capabilities.payload.largeDocumentPolicy.manifestStrategy, "inline-or-streaming-manifest-document-input.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.structuredZipFileRefStrategy, "structured-zip-entry-bounded-or-streaming.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.binaryProfileStrategy, "bounded-binary-file-profile.v1");
  assert.equal(capabilities.payload.largeDocumentPolicy.structuredJsonFileRefStrategy, "structured-json-file-ref-streaming-window.v1");
  assert.equal(capabilities.payload.parserExecution.payloadModes.includes("rawDocumentsManifestPath"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("input.manifest.jsonl"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("input.manifest.json"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("content.signature"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("markdown.frontmatter"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("markdown.structure"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured.json.file-ref-stream"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured-zip.structural-entry-plan"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured-zip.large-entry-stream"), true);
  assert.equal(capabilities.payload.formatConversion.strategy, "office-document-professional-adaptation.v1");
  assert.equal(capabilities.payload.formatConversion.qualityGateEvaluationStrategy, "professional-format-quality-gates.v1");
  assert.equal(capabilities.payload.formatConversion.outputArtifactValidationStrategy, "format-conversion-output-artifact-self-check.v1");
  assert.equal(capabilities.payload.formatConversion.artifact, "format-conversion-plan-json");
  assert.equal(capabilities.payload.formatConversion.professionalManifestArtifact, "professional-format-manifest-json");
  assert.equal(capabilities.payload.formatConversion.modeSeparationStrategy, "human-agent-response-profile-separation.v1");
  assert.equal(capabilities.payload.formatConversion.professionalFormats.includes("spreadsheet"), true);
  assert.equal(capabilities.payload.formatConversion.humanReadableTargets.includes("portable-docx"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("frontmatter"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("charts"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("chartSeries"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("formFields"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("contentControls"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("bookmarks"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("definedNames"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("namedRanges"), true);
  assert.equal(capabilities.payload.formatConversion.preserves.includes("printAreas"), true);
  for (const [routeId, parserProfile, qualityGate] of [
    ["pdf", "pdf.text-layout-ocr-route", "page-order-preserved"],
    ["word", "wordprocessingml-paragraph-style-route", "word-annotation-refs-preserved"],
    ["presentation", "presentationml-slide-route", "slide-order-preserved"],
    ["spreadsheet", "spreadsheetml-sheet-row-cell-route", "sheet-row-cell-refs-preserved"],
    ["markdown", "markdown-block-element-route", "heading-tree-preserved"]
  ]) {
    const adapter = capabilities.payload.formatConversion.formatMatrix.find((item) => item.routeId === routeId);
    assert.ok(adapter, `${routeId} professional adapter must be advertised by container service`);
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
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-image-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-chart-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("word-revision-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-image-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("markdown-frontmatter-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-placeholder-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-image-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-chart-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("presentation-comment-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("opendocument-link-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-workbook-sheet-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-defined-name-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-merged-cell-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-comment-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-date-serials-normalized"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-hyperlink-refs-preserved"), true);
  assert.equal(capabilities.payload.formatConversion.qualityGates.includes("spreadsheet-chart-refs-preserved"), true);
  assert.equal(capabilities.payload.referenceGapReport.localAuditStrategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.strategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.auditCommand, "npm run server:external-kd:references");
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.syncCommand, "npm run server:external-kd:sync-references");
  assert.equal(capabilities.payload.referenceFrameworks.localAudit.expectedCount >= 6, true);
  assert.equal(capabilities.payload.timeFiltering.supported, true);
  assert.equal(capabilities.payload.timeFiltering.strategy, "document-window-time-filter.v1");
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".rtf"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".docm"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".dotx"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".pptm"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".ppsx"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".xlsm"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".xltx"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".xlsb"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".gif"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".odt"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".epub"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".pgm"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".yaml"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".toml"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".properties"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".env"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".svg"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".drawio"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".mmd"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".ipynb"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".ts"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".py"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".jsonc"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".diff"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".patch"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".ics"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".html"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".adoc"), true);
  assert.equal(capabilities.payload.fileCompatibility.supportedExtensions.includes(".tex"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("tika.text.app"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.tables"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.content-controls"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.bookmarks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.annotations"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.revisions"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.images"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.charts"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.styles"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.word.numbering"), true);
  assert.equal(capabilities.payload.parserExecution.payloadModes.includes("filePath"), true);
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
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("markup.structure"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("structured-zip.file-ref"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.text.pdftotext"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.subtype-route"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.outlines"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.form-fields"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("archive.expand-route"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.placeholders"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.tables"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.hyperlinks"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.images"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.charts"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.speaker-notes"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("office.presentation.comments"), true);
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
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("ocr.image.tesseract"), true);
  assert.equal(capabilities.payload.parserExecution.builtInParsers.includes("pdf.ocr.poppler-tesseract"), true);
  const referenceGapReport = await fetchJson(`${serviceUrl}/v1/reference-gap-report`);
  assert.equal(referenceGapReport.status, 200);
  assert.equal(referenceGapReport.payload.strategy, "reference-framework-gap-report.v1");
  assert.equal(referenceGapReport.payload.referenceFrameworks.localAudit.strategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(referenceGapReport.payload.referenceFrameworks.localAudit.auditCommand, "npm run server:external-kd:references");
  assert.equal(referenceGapReport.payload.referenceFrameworks.localAudit.syncCommand, "npm run server:external-kd:sync-references");
  assert.equal(referenceGapReport.payload.referenceFrameworks.localAudit.expectedCount >= 6, true);
  assert.equal(referenceGapReport.payload.frameworks.some((framework) => framework.id === "mineru" && framework.absorbedPatterns.length > 0), true);
  const referenceFrameworks = await fetchJson(`${serviceUrl}/v1/reference-frameworks`);
  assert.equal(referenceFrameworks.status, 200);
  assert.equal(referenceFrameworks.payload.localAudit.strategy, "reference-framework-local-checkout-audit.v1");
  assert.equal(referenceFrameworks.payload.localAudit.auditCommand, "npm run server:external-kd:references");
  assert.equal(referenceFrameworks.payload.localAudit.syncCommand, "npm run server:external-kd:sync-references");
  assert.equal(referenceFrameworks.payload.localAudit.expectedCount >= 6, true);

  const image = drawOcrPgm([
    "PACT OCR ROUTING",
    "PARSER EVIDENCE WINDOW",
    "DEPLOYMENT PROJECT"
  ]);
  const createRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container OCR route verification",
      title: "Container OCR route verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-ocr-image",
          title: "Container OCR Image",
          fileName: "container-ocr.pgm",
          mediaType: "image/x-portable-graymap",
          byteSize: image.buffer.length,
          contentBase64: image.buffer.toString("base64")
        }
      ]
    })
  });
  assert.equal(createRun.status, 201);
  assert.equal(createRun.payload.status, "completed");
  const document = createRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-ocr-image");
  assert.ok(document, "OCR image document must be present in the corpus plan");
  assert.equal(document.route.formatId, "image");
  assert.equal(document.parserTrace.some((trace) => trace.stage === "ocr.image" && trace.status === "completed"), true);
  assert.ok(document.quality.textCharacters > 0, "container OCR must produce distillable text");
  assert.equal(createRun.payload.result.agentMessage.responseProfile, "agent");
  assert.equal(createRun.payload.result.classification.strategy, "hashing_embedding_window_community_classification_v3");
  assert.equal(createRun.payload.result.classification.communityCount >= 1, true);
  assert.equal(createRun.payload.result.convergence.strategy, "hierarchical-domain-topic-project-convergence.v3");
  assert.equal(createRun.payload.result.grounding.strategy, "claim-evidence-topk-conflict-gating.v2");
  assert.equal(createRun.payload.result.graphEvidence.strategy, "graph-lite-entity-relationship-evidence-pack.v1");
  assert.equal(createRun.payload.result.graphEvidence.summary.entityCount > 0, true);

  const markdown = await fetch(`${serviceUrl}/v1/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/portable-markdown`);
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get("content-type") || "", /text\/markdown/);
  const docx = await fetch(`${serviceUrl}/v1/distillation/runs/${encodeURIComponent(createRun.payload.runId)}/artifacts/portable-docx`);
  assert.equal(docx.status, 200);
  const docxEntries = unzipSync(new Uint8Array(await docx.arrayBuffer()));
  assert.ok(docxEntries["[Content_Types].xml"], "container DOCX artifact must include OpenXML content types");
  assert.ok(docxEntries["word/document.xml"], "container DOCX artifact must include word/document.xml");
  const docxDocumentXml = Buffer.from(docxEntries["word/document.xml"]).toString("utf8");
  const docxStylesXml = Buffer.from(docxEntries["word/styles.xml"]).toString("utf8");
  assert.match(docxDocumentXml, /Container OCR|Category Distillations/);
  assert.match(docxDocumentXml, /w:pStyle w:val="Heading1"/, "container DOCX export must preserve headings as Word styles");
  assert.match(docxDocumentXml, /w:pStyle w:val="ListParagraph"/, "container DOCX export must preserve Markdown bullets as Word list paragraphs");
  assert.match(docxDocumentXml, /<w:tbl\b/, "container DOCX export must render Markdown tables as Word tables");
  assert.match(docxStylesXml, /w:styleId="CodeBlock"/, "container DOCX export must declare code-block style");

  const textPdf = buildTextPdfWithLink();
  const textPdfRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container text PDF hyperlink verification",
      title: "Container text PDF hyperlink verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-text-pdf",
          title: "Container Text PDF",
          fileName: "container-text.pdf",
          mediaType: "application/pdf",
          byteSize: textPdf.length,
          contentBase64: textPdf.toString("base64")
        }
      ]
    })
  });
  assert.equal(textPdfRun.status, 201);
  assert.equal(textPdfRun.payload.status, "completed");
  const textPdfDocument = textPdfRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-text-pdf");
  assert.ok(textPdfDocument, "container text PDF document must be present");
  assert.equal(textPdfDocument.route.formatId, "pdf");
  assert.equal(textPdfDocument.pdfProfile.subtype, "pdf-text");
  assert.equal(textPdfDocument.parserTrace.some((trace) => trace.stage === "pdf.text.basic" && trace.status === "completed"), true);
  assert.equal(textPdfDocument.parserTrace.some((trace) => trace.stage === "pdf.hyperlinks" && trace.status === "completed" && trace.links === 1), true);
  assert.equal(textPdfDocument.parserTrace.some((trace) => trace.stage === "pdf.outlines" && trace.status === "completed" && trace.outlines === 2), true);
  assert.equal(textPdfDocument.parserTrace.some((trace) => trace.stage === "pdf.form-fields" && trace.status === "completed" && trace.fields === 1 && trace.widgets === 1), true);
  assert.equal(textPdfDocument.elementPlan.elementTypes["pdf-text-block"] >= 1, true);
  assert.equal(textPdfDocument.elementPlan.elementTypes["pdf-outline"] >= 2, true);
  assert.equal(textPdfDocument.elementPlan.elementTypes["pdf-form-field"] >= 1, true);
  assert.equal(textPdfDocument.elementPlan.elementTypes.link >= 1, true);
  assert.equal(textPdfDocument.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "pdf-outline" &&
    ref.layout?.strategy === "pdf-outline-destination.v1"
  )) && /Container PDF Overview/.test(window.excerpt || "")), true);
  assert.equal(textPdfDocument.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.href === "https://example.test/container-pdf-evidence" &&
    ref.layout?.strategy === "pdf-uri-annotation.v1"
  ))), true);
  assert.equal(textPdfDocument.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "pdf-form-field" &&
    ref.form?.name === "Container Owner" &&
    ref.form?.value === "Runtime Team" &&
    ref.layout?.strategy === "pdf-form-field.v1"
  ))), true);
  assert.equal(textPdfRun.payload.result.formatConversionPlan.documents.some((document) => (
    document.routeId === "pdf" &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.pdfOutlineRefCount >= 2 &&
    document.evidence.pdfFormFieldRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-outline-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "pdf-form-fields-preserved" && gate.status === "passed")
  )), true);

  const scannedPdfRaster = drawOcrRaster([
    "SCANNED PDF ROUTING",
    "POPLER TESSERACT OCR",
    "PROJECT EVIDENCE"
  ]);
  const scannedPdf = buildImageOnlyPdf(scannedPdfRaster);
  const scannedPdfRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container scanned PDF OCR verification",
      title: "Container scanned PDF OCR verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-scanned-pdf",
          title: "Container Scanned PDF",
          fileName: "container-scanned.pdf",
          mediaType: "application/pdf",
          byteSize: scannedPdf.length,
          contentBase64: scannedPdf.toString("base64")
        }
      ]
    })
  });
  assert.equal(scannedPdfRun.status, 201);
  assert.equal(scannedPdfRun.payload.status, "completed");
  const scannedPdfDocument = scannedPdfRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-scanned-pdf");
  assert.ok(scannedPdfDocument, "scanned PDF must be present in the corpus plan");
  assert.equal(scannedPdfDocument.route.formatId, "pdf");
  assert.equal(scannedPdfDocument.route.pdfSubtype, "pdf-scanned");
  assert.equal(scannedPdfDocument.pdfProfile.strategy, "pdf-subtype-routing.v1");
  assert.equal(scannedPdfDocument.pdfProfile.subtype, "pdf-scanned");
  assert.equal(scannedPdfDocument.pdfProfile.imageObjectCount >= 1, true);
  assert.equal(scannedPdfDocument.pdfProfile.ocrCharacters > 0, true);
  assert.equal(scannedPdfDocument.parserTrace.some((trace) => trace.stage === "pdf.subtype-route" && trace.subtype === "pdf-scanned"), true);
  assert.equal(scannedPdfDocument.parserTrace.some((trace) => trace.stage === "pdf.text.basic" && trace.status === "empty"), true);
  assert.equal(scannedPdfDocument.parserTrace.some((trace) => trace.stage === "pdf.page-rasterize" && trace.status === "completed"), true);
  assert.equal(scannedPdfDocument.parserTrace.some((trace) => trace.stage === "ocr.page" && trace.status === "completed"), true);
  assert.ok(scannedPdfDocument.quality.textCharacters > 0, "container scanned PDF OCR must produce distillable text");

  const legacyDocText = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Legacy Tika Office fallback extracts project deployment evidence.\\par}";
  const legacyOfficeRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container legacy Office Tika verification",
      title: "Container legacy Office Tika verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-legacy-doc",
          title: "Container Legacy DOC",
          fileName: "container-legacy.doc",
          mediaType: "application/msword",
          byteSize: Buffer.byteLength(legacyDocText, "utf8"),
          contentBase64: Buffer.from(legacyDocText, "utf8").toString("base64")
        }
      ]
    })
  });
  assert.equal(legacyOfficeRun.status, 201);
  assert.equal(legacyOfficeRun.payload.status, "completed");
  const legacyDocument = legacyOfficeRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-legacy-doc");
  assert.ok(legacyDocument, "legacy Office document must be present in the corpus plan");
  assert.equal(legacyDocument.route.formatId, "word");
  assert.equal(legacyDocument.parserTrace.some((trace) => (
    (trace.stage === "office.word.structured" || trace.stage === "tika.text") &&
    trace.status === "completed"
  )), true);
  assert.equal(legacyDocument.elementPlan.strategy, "document-element-model.v1");
  assert.equal(["doc", "docx", "word"].includes(legacyDocument.elementPlan.sourceFormat), true);
  assert.equal(legacyDocument.elementPlan.elementTypes.paragraph >= 1, true);
  assert.ok(legacyDocument.quality.textCharacters > 0, "Legacy Office routes must produce distillable text");

  const msgText = "Container Outlook MSG Tika parser extracts service escalation schedule evidence.";
  const msgRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container Outlook MSG Tika verification",
      title: "Container Outlook MSG Tika verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-msg",
          title: "Container Outlook MSG",
          fileName: "container-message.msg",
          mediaType: "application/vnd.ms-outlook",
          byteSize: Buffer.byteLength(msgText, "utf8"),
          contentBase64: Buffer.from(msgText, "utf8").toString("base64")
        }
      ]
    })
  });
  assert.equal(msgRun.status, 201);
  assert.equal(msgRun.payload.status, "completed");
  const msgDocument = msgRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-msg");
  assert.ok(msgDocument, "MSG document must be present in the corpus plan");
  assert.equal(msgDocument.route.formatId, "email");
  assert.equal(msgDocument.parserTrace.some((trace) => trace.stage === "email.msg.tika" && trace.status === "completed"), true);
  assert.equal(msgDocument.parserTrace.some((trace) => trace.stage === "email.headers-body"), false);
  assert.ok(msgDocument.quality.textCharacters > 0, "Tika parser must produce distillable text for MSG routes");

  const openDocumentRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container OpenDocument structured parser verification",
      title: "Container OpenDocument structured parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-open-document",
          title: "Container OpenDocument",
          fileName: "container-project.odt",
          mediaType: "application/vnd.oasis.opendocument.text",
          contentBase64: zipBase64({
            "mimetype": "application/vnd.oasis.opendocument.text",
            "content.xml": [
              "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
              "<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" ",
              "xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" ",
              "xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\" ",
              "xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
              "<office:body><office:text><text:p>OpenDocument project convergence evidence for external distillation. <text:a xlink:href=\"https://example.com/container-odf\">container ODF link</text:a></text:p>",
              "<table:table table:name=\"Container ODF Decisions\">",
              "<table:table-row><table:table-cell><text:p>Owner</text:p></table:table-cell><table:table-cell><text:p>Decision</text:p></table:table-cell></table:table-row>",
              "<table:table-row><table:table-cell><text:p>Container</text:p></table:table-cell><table:table-cell><text:p>Preserve ODF cells in graph evidence</text:p></table:table-cell></table:table-row>",
              "</table:table></office:text></office:body>",
              "</office:document-content>"
            ].join("")
          })
        }
      ]
    })
  });
  assert.equal(openDocumentRun.status, 201);
  assert.equal(openDocumentRun.payload.status, "completed");
  const openDocument = openDocumentRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-open-document");
  assert.ok(openDocument, "OpenDocument source must be present in the corpus plan");
  assert.equal(openDocument.route.formatId, "open-document");
  assert.equal(openDocument.parserTrace.some((trace) => trace.stage === "open-document.structured" && trace.status === "completed"), true);
  assert.equal(openDocument.parserTrace.some((trace) => trace.stage === "open-document.tables" && trace.status === "completed" && trace.tables === 1 && trace.cells === 4), true);
  assert.equal(openDocument.parserTrace.some((trace) => trace.stage === "open-document.hyperlinks" && trace.status === "completed" && trace.links === 1), true);
  assert.equal(openDocument.elementPlan.strategy, "document-element-model.v1");
  assert.equal(openDocument.elementPlan.sourceFormat, "open-document");
  assert.equal(openDocument.elementPlan.elementTypes.paragraph >= 1, true);
  assert.equal(openDocument.elementPlan.elementTypes.link >= 1, true);
  assert.equal(openDocument.elementPlan.elementTypes["table-row"] >= 1, true);
  assert.equal(openDocument.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "table-row" &&
    ref.table?.format === "open-document" &&
    ref.cells?.some((cell) => cell.ref === "B2" && cell.header === "Decision")
  ))), true);
  assert.equal(openDocument.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.href === "https://example.com/container-odf"
  ))), true);
  assert.equal(openDocument.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.ok(openDocument.quality.textCharacters > 0, "OpenDocument parser must produce distillable text");

  const epubRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container EPUB parser verification",
      title: "Container EPUB parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-epub",
          title: "Container EPUB",
          fileName: "container-project.epub",
          mediaType: "application/epub+zip",
          contentBase64: zipBase64({
            "mimetype": "application/epub+zip",
            "META-INF/container.xml": "<?xml version=\"1.0\"?><container version=\"1.0\"></container>",
            "OEBPS/chapter1.xhtml": [
              "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>",
              "<h1>Project Evidence</h1>",
              "<p>EPUB chapter evidence belongs to the document distillation corpus.</p>",
              "</body></html>"
            ].join("")
          })
        }
      ]
    })
  });
  assert.equal(epubRun.status, 201);
  assert.equal(epubRun.payload.status, "completed");
  const epubDocument = epubRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-epub");
  assert.ok(epubDocument, "EPUB source must be present in the corpus plan");
  assert.equal(epubDocument.route.formatId, "ebook");
  assert.equal(epubDocument.parserTrace.some((trace) => trace.stage === "ebook.epub" && trace.status === "completed"), true);
  assert.equal(epubDocument.elementPlan.strategy, "document-element-model.v1");
  assert.equal(epubDocument.elementPlan.sourceFormat, "epub");
  assert.equal(epubDocument.elementPlan.elementTypes.heading >= 1, true);
  assert.equal(epubDocument.elementPlan.elementTypes.paragraph >= 1, true);
  assert.equal(epubDocument.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.ok(epubDocument.quality.textCharacters > 0, "EPUB parser must produce distillable text");

  const mboxRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container MBOX parser verification",
      title: "Container MBOX parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-mbox",
          title: "Container MBOX",
          fileName: "mailbox.mbox",
          mediaType: "application/mbox",
          contentBase64: mboxBase64()
        }
      ]
    })
  });
  assert.equal(mboxRun.status, 201);
  assert.equal(mboxRun.payload.status, "completed");
  const mboxParent = mboxRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-mbox");
  assert.ok(mboxParent, "MBOX parent must be present in corpus");
  assert.equal(mboxParent.route.formatId, "email");
  assert.equal(mboxParent.parserTrace.some((trace) => trace.stage === "email.mbox" && trace.status === "completed" && trace.messages === 2), true);
  assert.equal(mboxParent.parserTrace.some((trace) => trace.stage === "email.mbox-route" && trace.status === "completed"), true);
  const mboxMessage = mboxRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-mbox!message:1");
  assert.ok(mboxMessage, "MBOX message must be expanded");
  assert.equal(mboxMessage.parentSourceId, "container-mbox");
  assert.equal(mboxMessage.parserTrace.some((trace) => trace.stage === "email.mbox-message" && trace.status === "expanded"), true);
  assert.equal(mboxMessage.parserTrace.some((trace) => trace.stage === "email.headers-body" && trace.status === "completed"), true);
  const mboxAttachment = mboxRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-mbox!message:2!attachment:container-mbox-invoice.csv");
  assert.ok(mboxAttachment, "MBOX attachment must be expanded");
  assert.equal(mboxAttachment.route.formatId, "spreadsheet");
  assert.equal(mboxAttachment.parserTrace.some((trace) => trace.stage === "table.csv" && trace.status === "completed"), true);

  const projectPackageRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container project package recursive parser verification [Container runbook](https://example.test/container-runbook)",
      title: "Container project package recursive parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-project-package",
          title: "Container Project Package",
          fileName: "project-package.zip",
          mediaType: "application/zip",
          contentBase64: zipBase64({
            "docs/architecture.md": [
              "---",
              "owner: container-platform",
              "tags: [container, agent]",
              "---",
              "# Architecture",
              "External API namespace registration, route fallback, parser runtime health, deployment topology, and service capability contracts.",
              "[Container agent contract](https://example.test/container-agent)",
              "![Container topology](https://example.test/container-topology.png)"
            ].join("\n"),
            "finance/invoice.csv": "vendor,total,tax,payment_date\nAcme,42000,2100,2026-05-31\nGlobex,91000,4550,2026-06-30",
            "data/config.json": JSON.stringify({ parser: "archive child route", project: "distillation", ocr: true, grounding: true }),
            "ops/service.env": [
              "PACT_MODE=container",
              "DISTILLATION_SERVICE_NAMESPACE=external.knowledge.distillation",
              "PARSER_STRATEGY=route-first",
              "PROJECT_CONVERGENCE_LAYER=window-community-topic-project",
              "GROUNDING_REQUIRED=true",
              "AGENT_RESPONSE_PROFILE=agent"
            ].join("\n"),
            "diagrams/system.mmd": [
              "flowchart LR",
              "  Console[Human console] --> API[external.knowledge.distillation API]",
              "  API --> Agent[Agent machine message]",
              "  API --> Evidence[Graph evidence pack]",
              "  Evidence --> Project[Project convergence report]"
            ].join("\n"),
            "notebooks/experiment.ipynb": JSON.stringify({
              cells: [
                {
                  cell_type: "markdown",
                  source: ["# Container Experiment\n", "Notebook evidence tracks project convergence and grounding metrics."]
                },
                {
                  cell_type: "code",
                  source: ["project_score = 0.88\n", "print('project convergence score', project_score)"],
                  outputs: [{ output_type: "stream", name: "stdout", text: ["project convergence score 0.88\n"] }]
                }
              ],
              metadata: { kernelspec: { name: "python3", language: "python" }, language_info: { name: "python" } },
              nbformat: 4,
              nbformat_minor: 5
            }),
            "src/runtime.py": [
              "import json",
              "from pathlib import Path",
              "",
              "class ProjectConvergenceRuntime:",
              "    def __init__(self, root: Path):",
              "        self.root = root",
              "",
              "    def build_evidence_pack(self, source):",
              "        # TODO: connect code symbols to graph evidence.",
              "        return json.dumps({'source': str(source)})",
              "",
              "def main():",
              "    runtime = ProjectConvergenceRuntime(Path('.'))",
              "    print(runtime.build_evidence_pack('container'))",
              "",
              "if __name__ == '__main__':",
              "    main()"
            ].join("\n"),
            "changes/runtime.diff": [
              "diff --git a/src/runtime.py b/src/runtime.py",
              "index 1111111..2222222 100644",
              "--- a/src/runtime.py",
              "+++ b/src/runtime.py",
              "@@ -6,7 +6,9 @@ class ProjectConvergenceRuntime:",
              "     def build_evidence_pack(self, source):",
              "-        return json.dumps({'source': str(source)})",
              "+        routed = {'source': str(source), 'mode': 'diff-aware'}",
              "+        routed['parser'] = 'diff.unified'",
              "+        return json.dumps(routed)",
              ""
            ].join("\n"),
            "calendar/release.ics": [
              "BEGIN:VCALENDAR",
              "VERSION:2.0",
              "PRODID:-//Pact//Container KD//EN",
              "BEGIN:VEVENT",
              "UID:container-release-20260615@example.test",
              "DTSTART:20260615T120000Z",
              "DTEND:20260615T130000Z",
              "SUMMARY:Container project convergence review",
              "LOCATION:Container Lab",
              "DESCRIPTION:Verify archive child routing, calendar timeline extraction, and graph evidence convergence.",
              "END:VEVENT",
              "END:VCALENDAR"
            ].join("\n"),
            "docs/runbook.adoc": [
              "= External KD Runbook",
              ":owner: platform-runtime",
              "",
              "== Parser Strategy",
              "The AsciiDoc runbook validates markup.structure inside archive child routing.",
              "",
              "* Route by file format before fallback.",
              "* Preserve agent-facing links and tables.",
              "",
              "link:https://example.test/kd[Knowledge distillation API]",
              "",
              "|===",
              "|Stage |Status",
              "|markup.structure |completed",
              "|==="
            ].join("\n")
          })
        }
      ]
    })
  });
  assert.equal(projectPackageRun.status, 201);
  assert.equal(projectPackageRun.payload.status, "completed");
  const projectPackage = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package");
  assert.ok(projectPackage, "project ZIP package must remain visible as the parent corpus document");
  assert.equal(projectPackage.route.formatId, "archive");
  assert.equal(projectPackage.parserTrace.some((trace) => trace.stage === "archive.expand-route" && trace.status === "completed"), true);
  const markdownChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!docs/architecture.md");
  assert.ok(markdownChild, "project package Markdown child must be expanded");
  assert.equal(markdownChild.parentSourceId, "container-project-package");
  assert.equal(markdownChild.route.formatId, "markdown");
  assert.equal(markdownChild.parserTrace.some((trace) => trace.stage === "text.markdown" && trace.status === "completed"), true);
  assert.equal(markdownChild.parserTrace.some((trace) => trace.stage === "markdown.frontmatter" && trace.status === "completed" && trace.fields >= 2 && trace.frontmatter >= 2), true);
  assert.equal(markdownChild.parserTrace.some((trace) => trace.stage === "markdown.structure" && trace.links >= 1 && trace.images >= 1), true);
  assert.equal(markdownChild.elementPlan.elementTypes.frontmatter >= 2, true);
  assert.equal(markdownChild.elementPlan.elementTypes.link >= 1, true);
  assert.equal(markdownChild.elementPlan.elementTypes.image >= 1, true);
  assert.equal(markdownChild.elementPlan.sampleElements.some((element) => (
    element.type === "frontmatter" &&
    element.frontmatter?.key === "owner" &&
    element.frontmatter?.value === "container-platform"
  )), true);
  assert.equal(markdownChild.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "frontmatter" &&
    ref.frontmatter?.key === "owner" &&
    ref.frontmatter?.value === "container-platform"
  ))), true);
  assert.equal(markdownChild.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "link" &&
    ref.href === "https://example.test/container-agent"
  ))), true);
  assert.equal(markdownChild.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
    ref.type === "image" &&
    ref.href === "https://example.test/container-topology.png"
  ))), true);
  assert.equal(projectPackageRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "container-project-package!docs/architecture.md" &&
    unit.metadata?.elementRefs?.some((ref) => (
      ref.type === "frontmatter" &&
      ref.frontmatter?.key === "owner" &&
      ref.frontmatter?.value === "container-platform"
    ))
  )), true);
  const csvChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!finance/invoice.csv");
  assert.ok(csvChild, "project package CSV child must be expanded");
  assert.equal(csvChild.parentSourceId, "container-project-package");
  assert.equal(csvChild.route.formatId, "spreadsheet");
  assert.equal(csvChild.parserTrace.some((trace) => trace.stage === "table.csv" && trace.status === "completed"), true);
  const configChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!ops/service.env");
  assert.ok(configChild, "project package dotenv child must be expanded");
  assert.equal(configChild.parentSourceId, "container-project-package");
  assert.equal(configChild.route.formatId, "config");
  assert.equal(configChild.parserTrace.some((trace) => trace.stage === "config.key-value" && trace.status === "completed"), true);
  const diagramChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!diagrams/system.mmd");
  assert.ok(diagramChild, "project package Mermaid child must be expanded");
  assert.equal(diagramChild.parentSourceId, "container-project-package");
  assert.equal(diagramChild.route.formatId, "diagram");
  assert.equal(diagramChild.parserTrace.some((trace) => trace.stage === "diagram.structure" && trace.status === "completed"), true);
  const notebookChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!notebooks/experiment.ipynb");
  assert.ok(notebookChild, "project package Notebook child must be expanded");
  assert.equal(notebookChild.parentSourceId, "container-project-package");
  assert.equal(notebookChild.route.formatId, "notebook");
  assert.equal(notebookChild.parserTrace.some((trace) => trace.stage === "notebook.cells" && trace.status === "completed" && trace.cells === 2), true);
  const sourceChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!src/runtime.py");
  assert.ok(sourceChild, "project package source code child must be expanded");
  assert.equal(sourceChild.parentSourceId, "container-project-package");
  assert.equal(sourceChild.route.formatId, "source-code");
  assert.equal(sourceChild.parserTrace.some((trace) => trace.stage === "code.structure" && trace.status === "completed" && trace.language === "python" && trace.imports >= 2 && trace.symbols >= 3 && trace.entryPoints >= 1), true);
  const diffChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!changes/runtime.diff");
  assert.ok(diffChild, "project package diff child must be expanded");
  assert.equal(diffChild.parentSourceId, "container-project-package");
  assert.equal(diffChild.route.formatId, "diff");
  assert.equal(diffChild.parserTrace.some((trace) => trace.stage === "diff.unified" && trace.status === "completed" && trace.files === 1 && trace.hunks === 1 && trace.additions === 3 && trace.deletions === 1), true);
  const calendarChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!calendar/release.ics");
  assert.ok(calendarChild, "project package calendar child must be expanded");
  assert.equal(calendarChild.parentSourceId, "container-project-package");
  assert.equal(calendarChild.route.formatId, "calendar");
  assert.equal(calendarChild.parserTrace.some((trace) => trace.stage === "calendar.ics" && trace.status === "completed" && trace.events === 1 && trace.from === "2026-06-15"), true);
  assert.equal(calendarChild.timeRange.from, "2026-06-15");
  const markupChild = projectPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-project-package!docs/runbook.adoc");
  assert.ok(markupChild, "project package AsciiDoc child must be expanded");
  assert.equal(markupChild.parentSourceId, "container-project-package");
  assert.equal(markupChild.route.formatId, "markup");
  assert.equal(markupChild.parserTrace.some((trace) => trace.stage === "markup.structure" && trace.status === "completed" && trace.format === "asciidoc" && trace.headings >= 2 && trace.listItems >= 2 && trace.links >= 1 && trace.tables >= 2), true);
  assert.equal(markupChild.elementPlan.strategy, "document-element-model.v1");
  assert.equal(markupChild.elementPlan.sourceFormat, "asciidoc");
  assert.equal(markupChild.elementPlan.elementTypes.heading >= 2, true);
  assert.equal(markupChild.windowPlan.strategy, "element-aware-by-title-windowing.v1");
  assert.equal(markupChild.windowPlan.source.kind, "structure-elements");
  assert.equal(markupChild.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => ref.type === "table-row")), true);
  assert.match(markupChild.windowPlan.windows[0]?.excerpt || "", /External KD Runbook|Parser Strategy|markup\.structure/);
  assert.equal(projectPackageRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "container-project-package!docs/runbook.adoc" &&
    unit.metadata?.semanticChunkStrategy === "unstructured.by-title-element-windowing.v1" &&
    unit.metadata?.elementTypes?.includes("table-row")
  )), true);
  const candidateSourceIds = new Set(projectPackageRun.payload.result.candidates.flatMap((candidate) => candidate.sourceIds || []));
  assert.equal(candidateSourceIds.has("container-project-package!docs/architecture.md"), true);
  assert.equal(candidateSourceIds.has("container-project-package!finance/invoice.csv"), true);
  assert.equal(candidateSourceIds.has("container-project-package!ops/service.env"), true);
  assert.equal(candidateSourceIds.has("container-project-package!diagrams/system.mmd"), true);
  assert.equal(candidateSourceIds.has("container-project-package!notebooks/experiment.ipynb"), true);
  assert.equal(candidateSourceIds.has("container-project-package!src/runtime.py"), true);
  assert.equal(candidateSourceIds.has("container-project-package!changes/runtime.diff"), true);
  assert.equal(candidateSourceIds.has("container-project-package!calendar/release.ics"), true);
  assert.equal(candidateSourceIds.has("container-project-package!docs/runbook.adoc"), true);
  assert.equal(projectPackageRun.payload.result.classification.coreGroupCount >= 2, true);
  assert.equal(projectPackageRun.payload.result.classification.groups.some((group) => (
    group.sourceIds.includes("container-project-package!docs/architecture.md") &&
    group.topicHierarchy?.strategy === "semantic-concept-topic-hierarchy.v1" &&
    Array.isArray(group.assignmentRationale?.documents) &&
    group.windowCommunities.length >= 1 &&
    group.distillationUnit.mode === "topic-isolated"
  )), true);
  assert.equal(projectPackageRun.payload.result.classification.groups.some((group) => (
    group.sourceIds.includes("container-project-package!finance/invoice.csv") &&
    group.topicHierarchy?.primaryConcept === "finance" &&
    group.assignmentRationale?.documents?.some((document) => /threshold/.test(document.reason || "")) &&
    typeof group.separationScore === "number"
  )), true);
  assert.equal(projectPackageRun.payload.result.candidates.every((candidate) => candidate.distillationUnitId), true);
  assert.equal(projectPackageRun.payload.result.candidates.every((candidate) => candidate.promoted && candidate.promotionGate.entailed >= 1), true);
  assert.equal(projectPackageRun.payload.result.convergence.strategy, "hierarchical-domain-topic-project-convergence.v3");
  assert.equal(projectPackageRun.payload.result.convergence.domainReports.some((domain) => (
    domain.domainKey === "finance" &&
    domain.routeIds.includes("spreadsheet") &&
    domain.sourceIds.includes("container-project-package!finance/invoice.csv")
  )), true);
  assert.equal(projectPackageRun.payload.result.convergence.domainReports.some((domain) => (
    domain.domainKey === "src" &&
    domain.routeIds.includes("source-code")
  )), true);
  assert.equal(projectPackageRun.payload.result.convergence.agentQueryIndex.domains.some((domain) => (
    domain.domainKey === "docs" &&
    domain.sourceIds.includes("container-project-package!docs/architecture.md")
  )), true);
  assert.equal(projectPackageRun.payload.result.convergence.communityReports.length >= 2, true);
  assert.equal(projectPackageRun.payload.result.graphEvidence.summary.textUnitCount >= projectPackageRun.payload.result.corpusPlan.windowCount, true);
  assert.equal(projectPackageRun.payload.result.graphEvidence.text_units.some((unit) => (
    unit.sourceId === "container-project-package!finance/invoice.csv" &&
    unit.metadata?.projectDomain === "finance"
  )), true);
  assert.equal(projectPackageRun.payload.result.graphEvidence.summary.relationshipCount > 0, true);
  assert.equal(projectPackageRun.payload.result.referenceGapReport.strategy, "reference-framework-gap-report.v1");
  assert.equal(projectPackageRun.payload.result.referenceGapReport.absorbedCapabilityMap.projectConvergence.references.includes("graphrag"), true);
  const evidenceArtifact = await fetch(`${serviceUrl}/v1/distillation/runs/${encodeURIComponent(projectPackageRun.payload.runId)}/artifacts/evidence-pack-json`);
  assert.equal(evidenceArtifact.status, 200);
  const evidencePack = JSON.parse(await evidenceArtifact.text());
  assert.equal(evidencePack.strategy, "graph-lite-entity-relationship-evidence-pack.v1");
  assert.equal(evidencePack.entities.length > 0, true);
  assert.equal(evidencePack.relationships.length > 0, true);
  assert.equal(evidencePack.covariates.some((claim) => claim.covariate_type === "claim"), true);
  const conversionArtifact = await fetch(`${serviceUrl}/v1/distillation/runs/${encodeURIComponent(projectPackageRun.payload.runId)}/artifacts/format-conversion-plan-json`);
  assert.equal(conversionArtifact.status, 200);
  const conversionPlan = JSON.parse(await conversionArtifact.text());
  assert.equal(conversionPlan.strategy, "office-document-professional-adaptation.v1");
  assert.equal(conversionPlan.runId, projectPackageRun.payload.runId);
  assert.equal(conversionPlan.professionalFormats.includes("spreadsheet"), true);
  assert.equal(conversionPlan.formatMatrix.some((item) => item.routeId === "markdown" && item.parserProfile === "markdown-block-element-route"), true);
  assert.equal(conversionPlan.summary.targetFormats.includes("docx"), true);
  assert.equal(conversionPlan.summary.qualityGates.includes("heading-tree-preserved"), true);
  assert.equal(conversionPlan.summary.qualityGates.includes("markdown-link-refs-preserved"), true);
  assert.equal(conversionPlan.summary.qualityGates.includes("markdown-image-refs-preserved"), true);
  assert.equal(conversionPlan.summary.qualityGates.includes("markdown-frontmatter-refs-preserved"), true);
  assert.equal(conversionPlan.summary.documentWithImageRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.documentWithFrontmatterRefsCount >= 1, true);
  assert.equal(conversionPlan.summary.outputArtifactFailedCount, 0);
  assert.equal(conversionPlan.outputArtifactValidation.artifacts.some((artifact) => (
    artifact.artifactId === "portable-docx" &&
    artifact.status === "passed" &&
    artifact.gates.some((gate) => gate.gate === "word-document-body-present" && gate.status === "passed") &&
    artifact.gates.some((gate) => gate.gate === "word-heading-styles-present" && gate.status === "passed") &&
    artifact.gates.some((gate) => gate.gate === "word-list-and-code-styles-present" && gate.status === "passed") &&
    artifact.gates.some((gate) => gate.gate === "word-table-elements-well-formed" && gate.status === "passed") &&
    artifact.gates.some((gate) => gate.gate === "word-hyperlinks-well-formed" && gate.status === "passed" && gate.observed.hyperlinkCount >= 1)
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "spreadsheet" &&
    document.conversionTargets.includes("agent-json-with-workbook-sheet-cell-coordinates-and-formulas") &&
    document.professionalFamily === "office-spreadsheet" &&
    document.qualityGates.includes("spreadsheet-workbook-sheet-refs-preserved") &&
    document.qualityGates.includes("spreadsheet-merged-cell-refs-preserved") &&
    document.qualityGates.includes("spreadsheet-comment-refs-preserved") &&
    document.qualityGates.includes("spreadsheet-date-serials-normalized") &&
    document.qualityGates.includes("formula-text-preserved") &&
    document.qualityGates.includes("spreadsheet-hyperlink-refs-preserved") &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-workbook-sheet-refs-preserved" && ["passed", "not_applicable"].includes(gate.status)) &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-merged-cell-refs-preserved" && ["passed", "not_applicable"].includes(gate.status)) &&
    document.qualityGateResults.some((gate) => gate.gate === "spreadsheet-comment-refs-preserved" && ["passed", "not_applicable"].includes(gate.status)) &&
    document.qualityGateResults.some((gate) => (
      gate.gate === "spreadsheet-date-serials-normalized" &&
      ["passed", "warning", "not_applicable"].includes(gate.status)
    )) &&
    document.qualityGateResults.some((gate) => (
      gate.gate === "sheet-row-cell-refs-preserved" &&
      ["passed", "warning", "not_applicable"].includes(gate.status)
    )) &&
    document.openability.docxOpenXmlPackage === true
  )), true);
  assert.equal(conversionPlan.documents.some((document) => (
    document.routeId === "markdown" &&
    document.professionalFamily === "markdown" &&
    document.conversionAdapters.some((adapter) => adapter.adapter === "markdown-blocks-to-valid-openxml.v1") &&
    document.parserStages.includes("markdown.frontmatter") &&
    document.preserves.includes("frontmatter") &&
    document.evidence.frontmatterRefCount >= 2 &&
    document.evidence.linkElementCount >= 1 &&
    document.evidence.imageRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-frontmatter-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-link-refs-preserved" && gate.status === "passed") &&
    document.qualityGateResults.some((gate) => gate.gate === "markdown-image-refs-preserved" && gate.status === "passed")
  )), true);
  const architectureSourceEvidence = await fetchJson(
    `${serviceUrl}/v1/distillation/runs/${encodeURIComponent(projectPackageRun.payload.runId)}/evidence?sourceId=container-project-package!docs%2Farchitecture.md&limit=20`
  );
  assert.equal(architectureSourceEvidence.status, 200);
  assert.equal(architectureSourceEvidence.payload.text_units.some((unit) => unit.metadata?.elementRefs?.some((ref) => (
    ref.type === "frontmatter" &&
    ref.frontmatter?.key === "owner" &&
    ref.frontmatter?.value === "container-platform"
  ))), true);
  const architectureEvidence = await fetchJson(
    `${serviceUrl}/v1/distillation/runs/${encodeURIComponent(projectPackageRun.payload.runId)}/evidence?entity=namespace&sourceId=container-project-package!docs%2Farchitecture.md&limit=20`
  );
  assert.equal(architectureEvidence.status, 200);
  assert.equal(architectureEvidence.payload.strategy, "graph-lite-evidence-query.v1");
  assert.equal(architectureEvidence.payload.text_units.length > 0, true);
  assert.equal(architectureEvidence.payload.entities.some((entity) => /namespace/i.test(entity.title)), true);
  const financeDomainEvidence = await fetchJson(
    `${serviceUrl}/v1/distillation/runs/${encodeURIComponent(projectPackageRun.payload.runId)}/evidence?domain=finance&routeId=spreadsheet&limit=20`
  );
  assert.equal(financeDomainEvidence.status, 200);
  assert.equal(financeDomainEvidence.payload.filters.domain, "finance");
  assert.equal(financeDomainEvidence.payload.filters.routeId, "spreadsheet");
  assert.equal(financeDomainEvidence.payload.text_units.some((textUnit) => (
    textUnit.metadata?.projectDomain === "finance" &&
    textUnit.metadata?.routeId === "spreadsheet"
  )), true);
  const juneEvidence = await fetchJson(
    `${serviceUrl}/v1/distillation/runs/${encodeURIComponent(projectPackageRun.payload.runId)}/evidence?sourceId=container-project-package!finance%2Finvoice.csv&timeFrom=2026-06-01&timeTo=2026-06-30&limit=20`
  );
  assert.equal(juneEvidence.status, 200);
  assert.equal(juneEvidence.payload.strategy, "graph-lite-evidence-query.v1");
  assert.equal(juneEvidence.payload.text_units.length > 0, true);
  assert.equal(juneEvidence.payload.text_units.every((textUnit) => textUnit.metadata?.timeRange), true);
  const workspacePackage = await fetch(`${serviceUrl}/v1/distillation/runs/${encodeURIComponent(projectPackageRun.payload.runId)}/artifacts/workspace-package-zip`);
  assert.equal(workspacePackage.status, 200);
  const workspaceEntries = unzipSync(new Uint8Array(await workspacePackage.arrayBuffer()));
  for (const entryName of ["manifest.json", "distillation.md", "distillation.docx", "console-summary.json", "agent-message.json", "result.json", "project-snapshot.json", "evidence-pack.json", "format-conversion-plan.json", "professional-format-manifest.json", "reference-gap-report.json"]) {
    assert.ok(workspaceEntries[entryName], `container workspace package must include ${entryName}`);
  }
  const workspaceManifest = JSON.parse(Buffer.from(workspaceEntries["manifest.json"]).toString("utf8"));
  assert.equal(workspaceManifest.artifacts.every((item) => item.byteSize > 0 && /^[a-f0-9]{64}$/.test(item.sha256)), true);
  assert.equal(workspaceManifest.artifacts.some((item) => item.artifactId === "console-summary-json" && item.path === "console-summary.json"), true);
  assert.equal(workspaceManifest.artifacts.some((item) => item.artifactId === "professional-format-manifest-json" && item.path === "professional-format-manifest.json"), true);
  const packageConsoleSummary = JSON.parse(Buffer.from(workspaceEntries["console-summary.json"]).toString("utf8"));
  assert.equal(packageConsoleSummary.responseProfile, "console");
  assert.equal(packageConsoleSummary.documents.every((document) => !Object.prototype.hasOwnProperty.call(document, "parserTrace")), true);
  const packageProfessionalManifest = JSON.parse(Buffer.from(workspaceEntries["professional-format-manifest.json"]).toString("utf8"));
  assert.equal(packageProfessionalManifest.strategy, "professional-format-manifest.v1");
  assert.equal(packageProfessionalManifest.modeSeparation.agentReadable.artifacts.includes("agent-message-json"), true);
  assert.equal(workspaceManifest.artifacts.some((item) => (
    item.artifactId === "portable-docx" &&
    item.validation?.status === "passed" &&
    item.validation.gates.some((gate) => gate.gate === "word-heading-styles-present" && gate.status === "passed")
  )), true);

  const contradictionRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container conflict evidence gate verification",
      title: "Container conflict evidence gate verification",
      responseProfile: "agent",
      requestedClaims: [
        "Legacy FTP upload is permitted for production evidence."
      ],
      rawDocuments: [
        {
          sourceId: "container-conflict-policy",
          title: "Container Conflict Policy",
          fileName: "conflict-policy.md",
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

  const incrementalFirstRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "container-incremental-project",
      query: "Container incremental first snapshot",
      title: "Container incremental first snapshot",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-inc-architecture",
          title: "Container Incremental Architecture",
          fileName: "architecture.md",
          mediaType: "text/markdown",
          text: "Container project routing supports signed object storage and parser runtime health."
        },
        {
          sourceId: "container-inc-finance",
          title: "Container Incremental Finance",
          fileName: "finance.csv",
          mediaType: "text/csv",
          text: "vendor,total,payment_date\nAlpha,100,2026-06-01"
        }
      ]
    })
  });
  assert.equal(incrementalFirstRun.status, 201);
  assert.equal(incrementalFirstRun.payload.result.incrementalPlan.mode, "full-snapshot");
  assert.equal(incrementalFirstRun.payload.result.incrementalPlan.snapshot.projectId, "container-incremental-project");

  const incrementalSecondRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "container-incremental-project",
      query: "Container incremental changed snapshot",
      title: "Container incremental changed snapshot",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-inc-architecture",
          title: "Container Incremental Architecture",
          fileName: "architecture.md",
          mediaType: "text/markdown",
          text: "Container project routing supports signed object storage and parser runtime health."
        },
        {
          sourceId: "container-inc-finance",
          title: "Container Incremental Finance",
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
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.reusedSourceIds.includes("container-inc-architecture"), true);
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.changedSourceIds.includes("container-inc-finance"), true);
  assert.equal(incrementalSecondRun.payload.result.incrementalPlan.reusedWindowCount >= 1, true);
  const snapshotArtifact = await fetch(`${serviceUrl}/v1/distillation/runs/${encodeURIComponent(incrementalSecondRun.payload.runId)}/artifacts/project-snapshot-json`);
  assert.equal(snapshotArtifact.status, 200);
  const snapshotPayload = JSON.parse(await snapshotArtifact.text());
  assert.equal(snapshotPayload.projectId, "container-incremental-project");
  assert.equal(snapshotPayload.previousRunId, incrementalFirstRun.payload.runId);
  const projectEvidence = await fetchJson(
    `${serviceUrl}/v1/projects/container-incremental-project/evidence?mode=all&runLimit=10&sourceId=container-inc-finance&timeFrom=2026-06-01&timeTo=2026-06-30&limit=50`
  );
  assert.equal(projectEvidence.status, 200);
  assert.equal(projectEvidence.payload.strategy, "project-graph-evidence-convergence-query.v1");
  assert.equal(projectEvidence.payload.evidenceQueryStrategy, "graph-lite-evidence-query.v1");
  assert.equal(projectEvidence.payload.matchedRunCount >= 2, true);
  assert.equal(projectEvidence.payload.runIds.includes(incrementalFirstRun.payload.runId), true);
  assert.equal(projectEvidence.payload.runIds.includes(incrementalSecondRun.payload.runId), true);
  assert.equal(projectEvidence.payload.text_units.length > 0, true);
  assert.equal(projectEvidence.payload.text_units.every((textUnit) => textUnit.sourceRunId), true);
  assert.equal(projectEvidence.payload.text_units.every((textUnit) => textUnit.sourceId === "container-inc-finance"), true);

  const tarPackageRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container TAR package recursive parser verification",
      title: "Container TAR package recursive parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-tar-package",
          title: "Container TAR Package",
          fileName: "project-package.tar",
          mediaType: "application/x-tar",
          contentBase64: tarBase64({
            "tar/architecture.md": "# TAR Architecture\nTAR routing expands child documents for project convergence.",
            "tar/payment.csv": "vendor,total\nTarContainer,128"
          })
        }
      ]
    })
  });
  assert.equal(tarPackageRun.status, 201);
  assert.equal(tarPackageRun.payload.status, "completed");
  const tarPackage = tarPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-tar-package");
  assert.equal(tarPackage.parserTrace.some((trace) => trace.stage === "archive.tar.container" && trace.status === "completed"), true);
  const tarChild = tarPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-tar-package!tar/architecture.md");
  assert.ok(tarChild, "TAR Markdown child must be expanded");
  assert.equal(tarChild.route.formatId, "markdown");
  assert.equal(tarChild.parserTrace.some((trace) => trace.stage === "text.markdown" && trace.status === "completed"), true);

  const tgzPackageRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container TGZ package recursive parser verification",
      title: "Container TGZ package recursive parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-tgz-package",
          title: "Container TGZ Package",
          fileName: "project-package.tgz",
          mediaType: "application/gzip",
          contentBase64: tgzBase64({
            "tgz/decision.md": "# TGZ Decision\nGzip decompression feeds TAR child routing.",
            "tgz/status.json": JSON.stringify({ archive: "tgz", childRouting: true })
          })
        }
      ]
    })
  });
  assert.equal(tgzPackageRun.status, 201);
  assert.equal(tgzPackageRun.payload.status, "completed");
  const tgzPackage = tgzPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-tgz-package");
  assert.equal(tgzPackage.parserTrace.some((trace) => trace.stage === "archive.gzip.decompress" && trace.status === "completed"), true);
  assert.equal(tgzPackage.parserTrace.some((trace) => trace.stage === "archive.tar.container" && trace.status === "completed"), true);
  const tgzChild = tgzPackageRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-tgz-package!tgz/status.json");
  assert.ok(tgzChild, "TGZ JSON child must be expanded");
  assert.equal(tgzChild.route.formatId, "json");
  assert.equal(tgzChild.parserTrace.some((trace) => trace.stage === "structured.json" && trace.status === "completed"), true);

  const sevenZipPayload = (await docker([
    "exec",
    containerName,
    "sh",
    "-lc",
    [
      "rm -rf /tmp/pact-7z-src /tmp/pact-verify.7z",
      "mkdir -p /tmp/pact-7z-src",
      "printf '%s\\n' '# 7z Decision' '7z external extraction feeds child routing.' > /tmp/pact-7z-src/decision.md",
      "printf '%s\\n' 'vendor,total' 'SevenZipCo,700' > /tmp/pact-7z-src/payment.csv",
      "cd /tmp/pact-7z-src",
      "(7zz a -t7z /tmp/pact-verify.7z decision.md payment.csv >/dev/null || 7z a -t7z /tmp/pact-verify.7z decision.md payment.csv >/dev/null)",
      "base64 -w0 /tmp/pact-verify.7z"
    ].join(" && ")
  ])).stdout.trim();
  const sevenZipRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container 7z package recursive parser verification",
      title: "Container 7z package recursive parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-7z-package",
          title: "Container 7z Package",
          fileName: "project-package.7z",
          mediaType: "application/x-7z-compressed",
          contentBase64: sevenZipPayload
        }
      ]
    })
  });
  assert.equal(sevenZipRun.status, 201);
  assert.equal(sevenZipRun.payload.status, "completed");
  const sevenZipPackage = sevenZipRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-7z-package");
  assert.equal(sevenZipPackage.parserTrace.some((trace) => trace.stage === "archive.7z.extract" && trace.status === "completed"), true);
  const sevenZipChild = sevenZipRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-7z-package!decision.md");
  assert.ok(sevenZipChild, "7z Markdown child must be expanded");
  assert.equal(sevenZipChild.route.formatId, "markdown");
  assert.equal(sevenZipChild.parserTrace.some((trace) => trace.stage === "text.markdown" && trace.status === "completed"), true);

  await docker([
    "exec",
    containerName,
    "sh",
    "-lc",
    [
      "mkdir -p /data /tmp/pact-mounted-archive",
      "printf '%s\\n' '# Mounted Input' 'Mounted filePath payloads avoid JSON base64 transport and enter normal distillation windows.' > /data/mounted-input.md",
      "printf '%s\\n' '# Manifest Input' > /data/manifest-input.md",
      "yes 'Container manifest JSONL input keeps request bodies small while filePath documents stream into windows.' | head -n 8000 >> /data/manifest-input.md",
      "printf '%s\\n' 'vendor,total,date' 'ContainerManifest,88,2026-07-03' > /data/manifest-input.csv",
      "printf '%s\\n' '{\"sourceId\":\"container-manifest-md\",\"title\":\"Container Manifest Markdown\",\"fileName\":\"manifest-input.md\",\"mediaType\":\"text/markdown\",\"filePath\":\"/data/manifest-input.md\"}' '{\"sourceId\":\"container-manifest-csv\",\"title\":\"Container Manifest CSV\",\"fileName\":\"manifest-input.csv\",\"mediaType\":\"text/csv\",\"filePath\":\"/data/manifest-input.csv\"}' > /data/raw-documents-manifest.jsonl",
      "dd if=/dev/zero of=/data/oversized-binary.pdf bs=1048576 count=9 status=none",
      "dd if=/dev/zero of=/data/oversized-unknown.asset bs=1048576 count=9 status=none && printf '%s' 'unknown-binary-head' | dd of=/data/oversized-unknown.asset bs=1 seek=0 conv=notrunc status=none",
      "printf '%s\\n' '# Mounted Archive Project' > /tmp/pact-mounted-archive/large-project.md",
      "yes 'Mounted archive package evidence must expand from filePath and stream child windows.' | head -n 120000 >> /tmp/pact-mounted-archive/large-project.md",
      "printf '%s\\n' 'vendor,total' 'ArchiveMountCo,256' > /tmp/pact-mounted-archive/invoice.csv",
      "tar -cf /data/mounted-project-package.tar -C /tmp/pact-mounted-archive large-project.md invoice.csv",
      "rm -rf /tmp/pact-mounted-structured",
      "mkdir -p /tmp/pact-mounted-structured/docx/word/_rels /tmp/pact-mounted-structured/docx/word/media /tmp/pact-mounted-structured/pptx/ppt/slides/_rels /tmp/pact-mounted-structured/pptx/ppt/notesSlides /tmp/pact-mounted-structured/pptx/ppt/comments /tmp/pact-mounted-structured/pptx/ppt/media /tmp/pact-mounted-structured/xlsx/xl/_rels /tmp/pact-mounted-structured/xlsx/xl/worksheets/_rels /tmp/pact-mounted-structured/odt /tmp/pact-mounted-structured/epub/META-INF /tmp/pact-mounted-structured/epub/OEBPS",
      "printf '%s' '<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><w:body><w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>Mounted DOCX Decision Register</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Mounted Routing Decisions</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"6\"/></w:numPr></w:pPr><w:r><w:t>Container mounted DOCX list hierarchy remains agent-readable.</w:t></w:r></w:p><w:p><w:r><w:t>Mounted DOCX filePath extraction validates structured service routing and project convergence evidence.</w:t></w:r></w:p><w:p><w:r><w:t>Container link: </w:t></w:r><w:hyperlink r:id=\"rId1\"><w:r><w:t>container DOCX link</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:drawing><wp:inline><wp:docPr id=\"12\" name=\"Container Architecture Image\" descr=\"Container DOCX architecture image evidence\"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed=\"rIdImage1\"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:p><w:ins w:id=\"14\" w:author=\"Container Revision Author\" w:date=\"2026-07-04T00:00:00Z\"><w:r><w:t>Container inserted tracked change remains agent-readable.</w:t></w:r></w:ins></w:p><w:p><w:del w:id=\"15\" w:author=\"Container Revision Author\" w:date=\"2026-07-05T00:00:00Z\"><w:r><w:delText>Container deleted tracked change remains agent-readable.</w:delText></w:r></w:del></w:p></w:body></w:document>' > /tmp/pact-mounted-structured/docx/word/document.xml",
      "printf '%s' '<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/container-docx\" TargetMode=\"External\"/><Relationship Id=\"rIdImage1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/container-architecture.png\"/></Relationships>' > /tmp/pact-mounted-structured/docx/word/_rels/document.xml.rels",
      "printf '%s' '<w:comments xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:comment w:id=\"8\" w:author=\"Container Reviewer\"><w:p><w:r><w:t>Container mounted DOCX comments remain agent-readable.</w:t></w:r></w:p></w:comment></w:comments>' > /tmp/pact-mounted-structured/docx/word/comments.xml",
      "printf '%s' '<w:footnotes xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:footnote w:id=\"9\"><w:p><w:r><w:t>Container mounted DOCX footnotes stay linked as annotation evidence.</w:t></w:r></w:p></w:footnote></w:footnotes>' > /tmp/pact-mounted-structured/docx/word/footnotes.xml",
      "printf '%s' 'container-docx-image-bytes' > /tmp/pact-mounted-structured/docx/word/media/container-architecture.png",
      "printf '%s' '<p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Mounted Slide Title\"/></p:nvSpPr><p:nvPr><p:ph type=\"title\" idx=\"0\"/></p:nvPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"457200\"/><a:ext cx=\"5486400\" cy=\"685800\"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Mounted PPTX filePath slide evidence enters structured parser windows. </a:t></a:r><a:r><a:rPr><a:hlinkClick r:id=\"rId1\"/></a:rPr><a:t>container PPTX link</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id=\"4\" name=\"Mounted Slide Body\"/></p:nvSpPr><p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"1371600\"/><a:ext cx=\"6400800\" cy=\"685800\"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Mounted PPTX body placeholder remains queryable for agent filters.</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id=\"5\" name=\"Container Roadmap Image\" descr=\"Container PPTX roadmap image evidence\"/></p:nvPicPr><p:spPr><a:xfrm><a:off x=\"914400\" y=\"2057400\"/><a:ext cx=\"1828800\" cy=\"685800\"/></a:xfrm></p:spPr><p:blipFill><a:blip r:embed=\"rIdImage1\"/></p:blipFill></p:pic><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"3\" name=\"Mounted Decision Table\"/></p:nvGraphicFramePr><p:xfrm><a:off x=\"914400\" y=\"2286000\"/><a:ext cx=\"6400800\" cy=\"914400\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Owner</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Decision</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Container PPTX</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Preserve mounted slide table cells</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>' > /tmp/pact-mounted-structured/pptx/ppt/slides/slide1.xml",
      "printf '%s' '<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/container-pptx\" TargetMode=\"External\"/><Relationship Id=\"rIdImage1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/container-roadmap.png\"/><Relationship Id=\"rIdComment1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments\" Target=\"../comments/comment1.xml\"/></Relationships>' > /tmp/pact-mounted-structured/pptx/ppt/slides/_rels/slide1.xml.rels",
      "printf '%s' 'container-pptx-image-bytes' > /tmp/pact-mounted-structured/pptx/ppt/media/container-roadmap.png",
      "printf '%s' '<p:notes xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Container mounted speaker notes remain queryable for agents.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>' > /tmp/pact-mounted-structured/pptx/ppt/notesSlides/notesSlide1.xml",
      "printf '%s' '<p:cmAuthorLst xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:cmAuthor id=\"0\" name=\"Container Slide Reviewer\" initials=\"CSR\" lastIdx=\"1\"/></p:cmAuthorLst>' > /tmp/pact-mounted-structured/pptx/ppt/commentAuthors.xml",
      "printf '%s' '<p:cmLst xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:cm authorId=\"0\" dt=\"2026-06-01T12:00:00Z\" idx=\"1\"><p:pos x=\"914400\" y=\"914400\"/><p:text>Container PPTX comment remains agent-readable.</p:text></p:cm></p:cmLst>' > /tmp/pact-mounted-structured/pptx/ppt/comments/comment1.xml",
      "printf '%s' '<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><si><t>Parser</t></si><si><t>Status</t></si><si><t>Report Date</t></si><si><t>Evidence Score</t></si><si><t>mounted xlsx</t></si><si><t>completed</t></si><si><t>2026-06-15</t></si></sst>' > /tmp/pact-mounted-structured/xlsx/xl/sharedStrings.xml",
      "printf '%s' '<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><cellXfs count=\"2\"><xf numFmtId=\"0\"/><xf numFmtId=\"14\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>' > /tmp/pact-mounted-structured/xlsx/xl/styles.xml",
      "printf '%s' '<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Container Evidence\" sheetId=\"11\" r:id=\"rIdSheet1\"/></sheets></workbook>' > /tmp/pact-mounted-structured/xlsx/xl/workbook.xml",
      "printf '%s' '<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdSheet1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>' > /tmp/pact-mounted-structured/xlsx/xl/_rels/workbook.xml.rels",
      "printf '%s' '<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheetData><row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c><c t=\"s\"><v>2</v></c><c t=\"s\"><v>3</v></c></row><row><c t=\"s\"><v>4</v></c><c t=\"s\"><v>5</v></c><c r=\"C2\" s=\"1\"><v>46188</v></c><c r=\"D2\"><f>LEN(B2)</f><v>9</v></c></row></sheetData><mergeCells count=\"1\"><mergeCell ref=\"A1:B1\"/></mergeCells><hyperlinks><hyperlink ref=\"B2\" r:id=\"rId1\" display=\"completed docs\"/></hyperlinks></worksheet>' > /tmp/pact-mounted-structured/xlsx/xl/worksheets/sheet1.xml",
      "printf '%s' '<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/container-xlsx\" TargetMode=\"External\"/><Relationship Id=\"rIdComment1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments\" Target=\"../comments1.xml\"/></Relationships>' > /tmp/pact-mounted-structured/xlsx/xl/worksheets/_rels/sheet1.xml.rels",
      "printf '%s' '<comments xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><authors><author>Container Analyst</author></authors><commentList><comment ref=\"B2\" authorId=\"0\"><text><r><t>Container XLSX status comment remains queryable.</t></r></text></comment></commentList></comments>' > /tmp/pact-mounted-structured/xlsx/xl/comments1.xml",
      "printf '%s' 'application/vnd.oasis.opendocument.text' > /tmp/pact-mounted-structured/odt/mimetype",
      "printf '%s' '<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><office:body><office:text><text:p>Mounted ODT filePath extraction keeps OpenDocument evidence distillable. <text:a xlink:href=\"https://example.com/container-mounted-odf\">container mounted ODF link</text:a></text:p></office:text></office:body></office:document-content>' > /tmp/pact-mounted-structured/odt/content.xml",
      "printf '%s' 'application/epub+zip' > /tmp/pact-mounted-structured/epub/mimetype",
      "printf '%s' '<?xml version=\"1.0\"?><container version=\"1.0\"></container>' > /tmp/pact-mounted-structured/epub/META-INF/container.xml",
      "printf '%s' '<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>Mounted EPUB Evidence</h1><p>Mounted EPUB filePath chapter routing verifies ebook compatibility.</p></body></html>' > /tmp/pact-mounted-structured/epub/OEBPS/chapter1.xhtml",
      "cd /tmp/pact-mounted-structured/docx && (7zz a -tzip /data/mounted-project-plan.docx word/document.xml word/_rels/document.xml.rels word/comments.xml word/footnotes.xml word/media/container-architecture.png >/dev/null || 7z a -tzip /data/mounted-project-plan.docx word/document.xml word/_rels/document.xml.rels word/comments.xml word/footnotes.xml word/media/container-architecture.png >/dev/null)",
      "cd /tmp/pact-mounted-structured/pptx && (7zz a -tzip /data/mounted-roadmap.pptx ppt/slides/slide1.xml ppt/slides/_rels/slide1.xml.rels ppt/notesSlides/notesSlide1.xml ppt/commentAuthors.xml ppt/comments/comment1.xml ppt/media/container-roadmap.png >/dev/null || 7z a -tzip /data/mounted-roadmap.pptx ppt/slides/slide1.xml ppt/slides/_rels/slide1.xml.rels ppt/notesSlides/notesSlide1.xml ppt/commentAuthors.xml ppt/comments/comment1.xml ppt/media/container-roadmap.png >/dev/null)",
      "cd /tmp/pact-mounted-structured/xlsx && (7zz a -tzip /data/mounted-evidence.xlsx xl/sharedStrings.xml xl/styles.xml xl/workbook.xml xl/_rels/workbook.xml.rels xl/worksheets/sheet1.xml xl/worksheets/_rels/sheet1.xml.rels xl/comments1.xml >/dev/null || 7z a -tzip /data/mounted-evidence.xlsx xl/sharedStrings.xml xl/styles.xml xl/workbook.xml xl/_rels/workbook.xml.rels xl/worksheets/sheet1.xml xl/worksheets/_rels/sheet1.xml.rels xl/comments1.xml >/dev/null)",
      "cd /tmp/pact-mounted-structured/odt && (7zz a -tzip /data/mounted-notes.odt mimetype content.xml >/dev/null || 7z a -tzip /data/mounted-notes.odt mimetype content.xml >/dev/null)",
      "cd /tmp/pact-mounted-structured/epub && (7zz a -tzip /data/mounted-handbook.epub mimetype META-INF/container.xml OEBPS/chapter1.xhtml >/dev/null || 7z a -tzip /data/mounted-handbook.epub mimetype META-INF/container.xml OEBPS/chapter1.xhtml >/dev/null)",
`node <<'NODE'
const fs = require("fs");
fs.writeFileSync("/data/mounted-large-records.json", JSON.stringify({
  project: "container external knowledge distillation",
  records: Array.from({ length: 110000 }, (_, index) => ({
    id: index + 1,
    domain: index % 2 === 0 ? "architecture" : "finance",
    evidence: "Container large JSON record " + (index + 1) + " must stream into distillation windows without binary fallback."
  }))
}));
const largeLegacyRtf = [
  "{\\\\rtf1\\\\ansi\\\\deff0{\\\\fonttbl{\\\\f0 Arial;}}\\\\f0\\\\fs24",
  Array.from({ length: 90000 }, (_, index) => "Mounted legacy DOC paragraph " + (index + 1) + " proves Tika filePath extraction avoids direct memory reads for oversized Office payloads.\\\\par").join("\\n"),
  "}"
].join("\\n");
fs.writeFileSync("/data/mounted-legacy-large.doc", largeLegacyRtf);
fs.writeFileSync("/data/mounted-notes.rtf", "{\\\\rtf1\\\\ansi\\\\deff0{\\\\fonttbl{\\\\f0 Arial;}}\\\\f0\\\\fs24 Mounted RTF filePath extraction keeps legacy text distillable.\\\\par}");
fs.writeFileSync("/data/mounted-legacy.ppt", "{\\\\rtf1\\\\ansi\\\\deff0{\\\\fonttbl{\\\\f0 Arial;}}\\\\f0\\\\fs24 Mounted legacy PPT route uses Tika filePath extraction.\\\\par}");
fs.writeFileSync("/data/mounted-legacy.xls", "{\\\\rtf1\\\\ansi\\\\deff0{\\\\fonttbl{\\\\f0 Arial;}}\\\\f0\\\\fs24 Mounted legacy XLS route uses Tika filePath extraction.\\\\par}");
fs.writeFileSync("/data/mounted-outlook.msg", "Mounted Outlook MSG filePath extraction uses Tika without direct memory reads.");
function obj(number, body) {
  return Buffer.from(number + " 0 obj\\n" + body + "\\nendobj\\n", "utf8");
}
function streamObj(number, body) {
  const stream = Buffer.from(body, "utf8");
  return Buffer.concat([
    Buffer.from(number + " 0 obj\\n<< /Length " + stream.length + " >>\\nstream\\n", "utf8"),
    stream,
    Buffer.from("\\nendstream\\nendobj\\n", "utf8")
  ]);
}
function escapePdfText(value) {
  return String(value).replace(/\\\\/g, "\\\\\\\\").replace(/\\(/g, "\\\\(").replace(/\\)/g, "\\\\)");
}
const pageCount = 160;
const objects = [
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>"),
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
];
const kids = [];
for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
  const pageNumber = 4 + (pageIndex * 2);
  const contentNumber = pageNumber + 1;
  kids.push(pageNumber + " 0 R");
  const lines = [];
  for (let lineIndex = 0; lineIndex < 45; lineIndex += 1) {
    const index = (pageIndex * 45) + lineIndex;
    lines.push("(" + escapePdfText("Mounted PDF filePath extraction evidence window " + index + " parser routing grounding project convergence.") + ") Tj T*");
  }
  const content = "BT /F1 10 Tf 72 760 Td 12 TL\\n" + lines.join("\\n") + "\\nET";
  objects.push(
    obj(pageNumber, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents " + contentNumber + " 0 R >>"),
    streamObj(contentNumber, content)
  );
}
objects.splice(1, 0, obj(2, "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pageCount + " >>"));
const chunks = [Buffer.from("%PDF-1.4\\n", "utf8")];
const offsets = [0];
for (const object of objects) {
  offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  chunks.push(object);
}
const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const xrefEntries = ["0000000000 65535 f ", ...offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ")];
chunks.push(Buffer.from(["xref", "0 " + (objects.length + 1), ...xrefEntries, "trailer", "<< /Size " + (objects.length + 1) + " /Root 1 0 R >>", "startxref", String(xrefOffset), "%%EOF", ""].join("\\n"), "utf8"));
fs.writeFileSync("/data/mounted-large-text.pdf", Buffer.concat(chunks));
NODE`
    ].join(" && ")
  ]);
  const filePathRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container filePath payload verification",
      title: "Container filePath payload verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-file-ref",
          title: "Container Mounted Input",
          fileName: "mounted-input.md",
          mediaType: "text/markdown",
          filePath: "/data/mounted-input.md"
        }
      ]
    })
  });
  assert.equal(filePathRun.status, 201);
  assert.equal(filePathRun.payload.status, "completed");
  const fileRef = filePathRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-file-ref");
  assert.ok(fileRef, "filePath source must be present in corpus");
  assert.equal(fileRef.quality.suppliedPayloadKind, "file-ref-stream");
  assert.equal(fileRef.windowPlan.strategy, "file-ref-stream-windowing.v1");
  assert.equal(fileRef.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed"), true);
  assert.equal(fileRef.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
  assert.equal(fileRef.parserTrace.some((trace) => trace.stage === "text.markdown" && trace.status === "completed"), true);

  const largeJsonRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container large JSON filePath verification",
      title: "Container large JSON filePath verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-large-json",
          title: "Container Large JSON",
          fileName: "mounted-large-records.json",
          mediaType: "application/json",
          filePath: "/data/mounted-large-records.json"
        }
      ],
      maxWindowCharacters: 8000,
      windowOverlapCharacters: 400
    })
  });
  assert.equal(largeJsonRun.status, 201);
  assert.equal(largeJsonRun.payload.status, "completed");
  const largeJson = largeJsonRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-large-json");
  assert.ok(largeJson, "large JSON filePath source must be present in corpus");
  assert.equal(largeJson.route.formatId, "json");
  assert.equal(largeJson.quality.suppliedPayloadKind, "file-ref-stream");
  assert.equal(largeJson.windowPlan.strategy, "file-ref-stream-windowing.v1");
  assert.equal(largeJson.windowPlan.windowCount > 1, true);
  assert.equal(largeJson.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed" && trace.mode === "streaming-windowed"), true);
  assert.equal(largeJson.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
  assert.equal(largeJson.parserTrace.some((trace) => trace.stage === "structured.json.file-ref-stream" && trace.status === "completed"), true);
  assert.equal(largeJson.parserTrace.some((trace) => trace.stage === "payload.file-ref-binary-profile"), false);

  const manifestRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container streaming manifest verification",
      title: "Container streaming manifest verification",
      responseProfile: "agent",
      rawDocumentsManifestPath: "/data/raw-documents-manifest.jsonl"
    })
  });
  assert.equal(manifestRun.status, 201);
  assert.equal(manifestRun.payload.status, "completed");
  assert.equal(manifestRun.payload.inputSummary.inputDocumentPlan.strategy, "inline-or-streaming-manifest-document-input.v1");
  assert.equal(manifestRun.payload.inputSummary.inputDocumentPlan.manifestDocumentCount, 2);
  assert.equal(manifestRun.payload.result.corpusPlan.inputDocumentPlan.manifests[0].stage, "input.manifest.jsonl");
  const manifestMd = manifestRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-manifest-md");
  const manifestCsv = manifestRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-manifest-csv");
  assert.ok(manifestMd, "container manifest Markdown source must be present in corpus");
  assert.ok(manifestCsv, "container manifest CSV source must be present in corpus");
  assert.equal(manifestMd.quality.suppliedPayloadKind, "file-ref-stream");
  assert.equal(manifestMd.windowPlan.strategy, "file-ref-stream-windowing.v1");
  assert.equal(manifestMd.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
  assert.equal(manifestCsv.route.formatId, "spreadsheet");
  assert.equal(manifestRun.payload.result.agentMessage.corpusPlan.inputDocumentPlan.manifestDocumentCount, 2);

  const mountedArchiveRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container mounted archive filePath verification",
      title: "Container mounted archive filePath verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-mounted-archive",
          title: "Container Mounted Archive",
          fileName: "mounted-project-package.tar",
          mediaType: "application/x-tar",
          filePath: "/data/mounted-project-package.tar"
        }
      ],
      maxWindowCharacters: 8000,
      windowOverlapCharacters: 400
    })
  });
  assert.equal(mountedArchiveRun.status, 201);
  assert.equal(mountedArchiveRun.payload.status, "completed");
  const mountedArchive = mountedArchiveRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-mounted-archive");
  assert.ok(mountedArchive, "mounted archive parent must be present in corpus");
  assert.equal(mountedArchive.route.formatId, "archive");
  assert.equal(mountedArchive.quality.suppliedPayloadKind, "file-ref-archive");
  assert.equal(mountedArchive.parserTrace.some((trace) => trace.stage === "archive.tar.extract" && trace.status === "completed"), true);
  assert.equal(mountedArchive.parserTrace.some((trace) => trace.stage === "archive.file-ref.entries" && trace.status === "completed"), true);
  assert.equal(mountedArchive.parserTrace.some((trace) => trace.stage === "archive.file-ref.expand" && trace.status === "completed"), true);
  assert.equal(mountedArchive.parserTrace.some((trace) => trace.stage === "archive.expand-route" && trace.status === "completed"), true);
  const mountedArchiveChild = mountedArchiveRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-mounted-archive!large-project.md");
  assert.ok(mountedArchiveChild, "mounted archive Markdown child must be expanded");
  assert.equal(mountedArchiveChild.route.formatId, "markdown");
  assert.equal(mountedArchiveChild.windowPlan.strategy, "file-ref-stream-windowing.v1");
  assert.equal(mountedArchiveChild.parserTrace.some((trace) => trace.stage === "archive.entry-file-ref" && trace.status === "expanded"), true);
  assert.equal(mountedArchiveChild.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
  assert.equal(mountedArchiveChild.windowPlan.windowCount > 1, true);

  const mountedPdfRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container mounted PDF filePath verification",
      title: "Container mounted PDF filePath verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-mounted-pdf",
          title: "Container Mounted PDF",
          fileName: "mounted-large-text.pdf",
          mediaType: "application/pdf",
          filePath: "/data/mounted-large-text.pdf"
        }
      ],
      maxWindowCharacters: 8000,
      windowOverlapCharacters: 400
    })
  });
  assert.equal(mountedPdfRun.status, 201);
  assert.equal(mountedPdfRun.payload.status, "completed");
  const mountedPdf = mountedPdfRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-mounted-pdf");
  assert.ok(mountedPdf, "mounted PDF filePath source must be present in corpus");
  assert.equal(mountedPdf.route.formatId, "pdf");
  assert.equal(mountedPdf.quality.suppliedPayloadKind, "file-ref-pdf");
  assert.equal(mountedPdf.windowPlan.strategy, "file-ref-stream-windowing.v1");
  assert.equal(mountedPdf.parserTrace.some((trace) => trace.stage === "pdf.text.pdftotext" && trace.status === "completed"), true);
  assert.equal(mountedPdf.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
  assert.equal(mountedPdf.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
  assert.equal(mountedPdf.windowPlan.windowCount > 1, true);

  const mountedStructuredRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container mounted structured ZIP filePath verification",
      title: "Container mounted structured ZIP filePath verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-mounted-docx",
          title: "Container Mounted DOCX",
          fileName: "mounted-project-plan.docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          filePath: "/data/mounted-project-plan.docx"
        },
        {
          sourceId: "container-mounted-pptx",
          title: "Container Mounted PPTX",
          fileName: "mounted-roadmap.pptx",
          mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          filePath: "/data/mounted-roadmap.pptx"
        },
        {
          sourceId: "container-mounted-xlsx",
          title: "Container Mounted XLSX",
          fileName: "mounted-evidence.xlsx",
          mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          filePath: "/data/mounted-evidence.xlsx"
        },
        {
          sourceId: "container-mounted-odt",
          title: "Container Mounted ODT",
          fileName: "mounted-notes.odt",
          mediaType: "application/vnd.oasis.opendocument.text",
          filePath: "/data/mounted-notes.odt"
        },
        {
          sourceId: "container-mounted-epub",
          title: "Container Mounted EPUB",
          fileName: "mounted-handbook.epub",
          mediaType: "application/epub+zip",
          filePath: "/data/mounted-handbook.epub"
        }
      ],
      maxWindowCharacters: 8000,
      windowOverlapCharacters: 400
    })
  });
  assert.equal(mountedStructuredRun.status, 201);
  assert.equal(mountedStructuredRun.payload.status, "completed");
  for (const [sourceId, formatId, stage] of [
    ["container-mounted-docx", "word", "office.word.structured"],
    ["container-mounted-pptx", "presentation", "office.presentation.slides"],
    ["container-mounted-xlsx", "spreadsheet", "table.sheet.structured"],
    ["container-mounted-odt", "open-document", "open-document.structured"],
    ["container-mounted-epub", "ebook", "ebook.epub"]
  ]) {
    const mountedStructured = mountedStructuredRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === sourceId);
    assert.ok(mountedStructured, `${sourceId} must be present in mounted structured corpus`);
    assert.equal(mountedStructured.route.formatId, formatId);
    assert.equal(mountedStructured.quality.suppliedPayloadKind, "file-ref-structured-zip");
    assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed"), true);
    assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "structured-zip.file-ref.extract" && trace.status === "completed"), true);
    assert.equal(mountedStructured.parserTrace.some((trace) => (
      trace.stage === "structured-zip.structural-entry-plan" &&
      trace.status === "completed" &&
      trace.strategy === "structured-zip-entry-bounded-or-streaming.v1" &&
      trace.loadedFiles >= 1
    )), true);
    assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === stage && trace.status === "completed"), true);
    if (formatId === "word") {
      assert.equal(mountedStructured.windowPlan.strategy, "element-aware-by-title-windowing.v1");
      assert.equal(mountedStructured.parserTrace.some((trace) => (
        trace.stage === "office.word.styles" &&
        trace.status === "completed" &&
        trace.styles >= 3
      )), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => (
        trace.stage === "office.word.numbering" &&
        trace.status === "completed" &&
        trace.numberingRefs === 1
      )), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => (
        trace.stage === "office.word.annotations" &&
        trace.status === "completed" &&
        trace.comments === 1 &&
        trace.footnotes === 1
      )), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => (
        trace.stage === "office.word.revisions" &&
        trace.status === "completed" &&
        trace.revisions === 2 &&
        trace.inserted === 1 &&
        trace.deleted === 1
      )), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => (
        trace.stage === "office.word.hyperlinks" &&
        trace.status === "completed" &&
        trace.links === 1
      )), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => (
        trace.stage === "office.word.images" &&
        trace.status === "completed" &&
        trace.images === 1
      )), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "list-item" &&
        ref.style?.styleId === "ListParagraph" &&
        ref.style?.numberingId === "6"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "comment" &&
        ref.annotation?.kind === "comment" &&
        ref.annotation?.author === "Container Reviewer"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "revision" &&
        ref.annotation?.kind === "word-revision" &&
        ref.annotation?.type === "insertion" &&
        ref.annotation?.author === "Container Revision Author"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "revision" &&
        ref.annotation?.kind === "word-revision" &&
        ref.annotation?.type === "deletion" &&
        ref.annotation?.author === "Container Revision Author"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "link" &&
        ref.href === "https://example.com/container-docx"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "image" &&
        ref.href === "word/media/container-architecture.png" &&
        ref.image?.relationshipId === "rIdImage1"
      ))), true);
    }
    if (formatId === "spreadsheet") {
      assert.equal(mountedStructured.windowPlan.strategy, "element-aware-by-title-windowing.v1");
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.workbook.sheets" && trace.status === "completed" && trace.sheets === 1 && trace.sheetRefs === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.sheet.headers" && trace.status === "completed"), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.sheet.cells" && trace.status === "completed" && trace.cells >= 4), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.sheet.merged-cells" && trace.status === "completed" && trace.mergedCells === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.sheet.comments" && trace.status === "completed" && trace.comments === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.sheet.date-styles" && trace.status === "completed" && trace.dateStyles === 1 && trace.dateCells === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.sheet.formulas" && trace.status === "completed" && trace.formulas === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.sheet.hyperlinks" && trace.status === "completed" && trace.hyperlinks === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "table.time-index" && trace.status === "completed" && trace.from === "2026-06-15"), true);
      assert.equal(mountedStructured.eventTime, "2026-06-15");
      assert.equal(mountedStructured.timeRange.from, "2026-06-15");
      assert.match(mountedStructured.windowPlan.windows[0]?.excerpt || "", /Sheet 1 \(Container Evidence\) (?:Merged range|Header row)|merge A1:B1|A=Parser|B=Status|C=Report Date/);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.timeRange?.from === "2026-06-15"), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "merged-cell" &&
        ref.merge?.ref === "A1:B1" &&
        ref.table?.sheetName === "Container Evidence"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "cell-comment" &&
        ref.annotation?.kind === "spreadsheet-comment" &&
        ref.annotation?.author === "Container Analyst" &&
        ref.cells?.some((cell) => cell.ref === "B2" && cell.comment?.text.includes("status comment"))
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "table-row" &&
        ref.table?.format === "xlsx" &&
        ref.table?.sheetName === "Container Evidence" &&
        ref.table?.sheetId === "11" &&
        ref.cells?.some((cell) => cell.ref === "D2" && cell.header === "Evidence Score" && cell.formula === "LEN(B2)")
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "table-row" &&
        ref.table?.format === "xlsx" &&
        ref.table?.sheetName === "Container Evidence" &&
        ref.cells?.some((cell) => (
          cell.ref === "C2" &&
          cell.header === "Report Date" &&
          cell.value === "2026-06-15" &&
          cell.rawValue === "46188" &&
          cell.dateIso === "2026-06-15" &&
          cell.dateSerial === "46188"
        ))
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "table-row" &&
        ref.table?.format === "xlsx" &&
        ref.cells?.some((cell) => cell.ref === "B2" && cell.hyperlink?.target === "https://example.com/container-xlsx")
      ))), true);
    }
    if (formatId === "presentation") {
      assert.equal(mountedStructured.windowPlan.strategy, "element-aware-by-title-windowing.v1");
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "office.presentation.placeholders" && trace.status === "completed" && trace.placeholders === 2), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "office.presentation.tables" && trace.status === "completed" && trace.cells === 4), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "office.presentation.hyperlinks" && trace.status === "completed" && trace.links === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "office.presentation.images" && trace.status === "completed" && trace.images === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "office.presentation.speaker-notes" && trace.status === "completed" && trace.notes === 1), true);
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "office.presentation.comments" && trace.status === "completed" && trace.comments === 1), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "heading" &&
        ref.shape?.id === "2" &&
        ref.shape?.placeholderType === "title"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "slide-shape" &&
        ref.shape?.id === "4" &&
        ref.shape?.placeholderType === "body"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "table-row" &&
        ref.table?.format === "presentationml" &&
        ref.cells?.some((cell) => cell.ref === "B2" && cell.header === "Decision")
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "link" &&
        ref.href === "https://example.com/container-pptx"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "image" &&
        ref.href === "ppt/media/container-roadmap.png" &&
        ref.image?.relationshipId === "rIdImage1"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "speaker-note" &&
        ref.layout?.strategy === "presentationml-speaker-notes.v1"
      ))), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "comment" &&
        ref.annotation?.kind === "presentation-comment" &&
        ref.annotation?.author === "Container Slide Reviewer" &&
        ref.annotation?.sourcePart === "ppt/comments/comment1.xml"
      ))), true);
    } else if (formatId === "open-document") {
      assert.equal(mountedStructured.windowPlan.strategy, "element-aware-by-title-windowing.v1");
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "open-document.hyperlinks" && trace.status === "completed" && trace.links === 1), true);
      assert.equal(mountedStructured.windowPlan.windows.some((window) => window.elementRefs?.some((ref) => (
        ref.type === "link" &&
        ref.href === "https://example.com/container-mounted-odf"
      ))), true);
    } else if (!["word", "spreadsheet"].includes(formatId)) {
      assert.equal(mountedStructured.windowPlan.strategy, "file-ref-stream-windowing.v1");
      assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
    }
    assert.equal(mountedStructured.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
    assert.ok(mountedStructured.quality.textCharacters > 0, `${sourceId} must produce distillable text`);
  }
  assert.equal(mountedStructuredRun.payload.result.formatConversionPlan.summary.documentWithRevisionRefsCount >= 1, true);
  assert.equal(mountedStructuredRun.payload.result.formatConversionPlan.documents.some((document) => (
    document.routeId === "word" &&
    document.evidence.revisionRefCount >= 2 &&
    document.qualityGateResults.some((gate) => gate.gate === "word-revision-refs-preserved" && gate.status === "passed")
  )), true);
  assert.equal(mountedStructuredRun.payload.result.formatConversionPlan.summary.documentWithPresentationCommentRefsCount >= 1, true);
  assert.equal(mountedStructuredRun.payload.result.formatConversionPlan.documents.some((document) => (
    document.routeId === "presentation" &&
    document.evidence.presentationCommentRefCount >= 1 &&
    document.qualityGateResults.some((gate) => gate.gate === "presentation-comment-refs-preserved" && gate.status === "passed")
  )), true);

  const signatureRoutedRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container content signature routing verification",
      title: "Container content signature routing verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-signature-pdf",
          title: "Container Signature PDF",
          fileName: "mounted-pdf.asset",
          mediaType: "application/octet-stream",
          filePath: "/data/mounted-large-text.pdf"
        },
        {
          sourceId: "container-signature-docx",
          title: "Container Signature DOCX",
          fileName: "mounted-docx.asset",
          mediaType: "application/octet-stream",
          filePath: "/data/mounted-project-plan.docx"
        },
        {
          sourceId: "container-signature-pptx",
          title: "Container Signature PPTX",
          fileName: "mounted-pptx.asset",
          mediaType: "application/octet-stream",
          filePath: "/data/mounted-roadmap.pptx"
        },
        {
          sourceId: "container-signature-xlsx",
          title: "Container Signature XLSX",
          fileName: "mounted-xlsx.asset",
          mediaType: "application/octet-stream",
          filePath: "/data/mounted-evidence.xlsx"
        },
        {
          sourceId: "container-variant-docm",
          title: "Container DOCM Variant",
          fileName: "mounted-project-plan.docm",
          mediaType: "application/vnd.ms-word.document.macroEnabled.12",
          filePath: "/data/mounted-project-plan.docx"
        },
        {
          sourceId: "container-variant-pptm",
          title: "Container PPTM Variant",
          fileName: "mounted-roadmap.pptm",
          mediaType: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
          filePath: "/data/mounted-roadmap.pptx"
        },
        {
          sourceId: "container-variant-xlsm",
          title: "Container XLSM Variant",
          fileName: "mounted-evidence.xlsm",
          mediaType: "application/vnd.ms-excel.sheet.macroEnabled.12",
          filePath: "/data/mounted-evidence.xlsx"
        }
      ],
      maxWindowCharacters: 8000,
      windowOverlapCharacters: 400
    })
  });
  assert.equal(signatureRoutedRun.status, 201);
  assert.equal(signatureRoutedRun.payload.status, "completed");
  for (const [sourceId, formatId, signature, sniffedExtension, stage] of [
    ["container-signature-pdf", "pdf", "pdf-header", ".pdf", "pdf.text.pdftotext"],
    ["container-signature-docx", "word", "zip-ooxml-word", ".docx", "office.word.structured"],
    ["container-signature-pptx", "presentation", "zip-ooxml-presentation", ".pptx", "office.presentation.slides"],
    ["container-signature-xlsx", "spreadsheet", "zip-ooxml-spreadsheet", ".xlsx", "table.sheet.structured"]
  ]) {
    const signatureRouted = signatureRoutedRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === sourceId);
    assert.ok(signatureRouted, `${sourceId} must be routed from content signature`);
    assert.equal(signatureRouted.route.formatId, formatId);
    assert.equal(signatureRouted.route.declaredExtension, ".asset");
    assert.equal(signatureRouted.route.declaredMediaType, "application/octet-stream");
    assert.equal(signatureRouted.route.sniffedExtension, sniffedExtension);
    assert.equal(signatureRouted.route.contentSignature, signature);
    assert.equal(signatureRouted.parserTrace.some((trace) => (
      trace.stage === "content.signature" &&
      trace.status === "completed" &&
      trace.applied === true &&
      trace.signature === signature
    )), true);
    assert.equal(signatureRouted.parserTrace.some((trace) => trace.stage === stage && trace.status === "completed"), true);
    assert.equal(signatureRouted.formatConversionProfile.conversionAdapters.some((adapter) => adapter.targetFormat === "docx"), true);
  }
  for (const [sourceId, formatId, extension, stage] of [
    ["container-variant-docm", "word", ".docm", "office.word.structured"],
    ["container-variant-pptm", "presentation", ".pptm", "office.presentation.slides"],
    ["container-variant-xlsm", "spreadsheet", ".xlsm", "table.sheet.structured"]
  ]) {
    const variantRouted = signatureRoutedRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === sourceId);
    assert.ok(variantRouted, `${sourceId} must be routed as an OOXML format variant`);
    assert.equal(variantRouted.route.formatId, formatId);
    assert.equal(variantRouted.route.extension, extension);
    assert.equal(variantRouted.quality.suppliedPayloadKind, "file-ref-structured-zip");
    assert.equal(variantRouted.parserTrace.some((trace) => trace.stage === stage && trace.status === "completed"), true);
    assert.equal(variantRouted.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
  }

  const timeFilteredRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container time-filtered corpus verification",
      title: "Container time-filtered corpus verification",
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
          sourceId: "container-time-may",
          title: "Container May Payment",
          fileName: "container-may-payment.csv",
          mediaType: "text/csv",
          contentBase64: Buffer.from("vendor,total,payment_date\nMayCo,10,2026-05-31", "utf8").toString("base64")
        },
        {
          sourceId: "container-time-june",
          title: "Container June Payment",
          fileName: "container-june-payment.csv",
          mediaType: "text/csv",
          contentBase64: Buffer.from("vendor,total,payment_date\nJuneCo,20,2026-06-15", "utf8").toString("base64")
        },
        {
          sourceId: "container-time-undated",
          title: "Container Undated",
          fileName: "container-undated.md",
          mediaType: "text/markdown",
          text: "# Undated\nThis note should not survive strict time filtering."
        }
      ]
    })
  });
  assert.equal(timeFilteredRun.status, 201);
  assert.equal(timeFilteredRun.payload.status, "completed");
  assert.equal(timeFilteredRun.payload.result.corpusPlan.timeFilter.active, true);
  assert.deepEqual(timeFilteredRun.payload.result.corpusPlan.documents.map((document) => document.sourceId), ["container-time-june"]);
  assert.equal(timeFilteredRun.payload.result.corpusPlan.timeFilter.filteredOutSourceIds.includes("container-time-may"), true);
  assert.equal(timeFilteredRun.payload.result.corpusPlan.timeFilter.filteredOutSourceIds.includes("container-time-undated"), true);
  assert.equal(timeFilteredRun.payload.result.corpusPlan.documents[0].timeRange.from, "2026-06-15");
  assert.equal(timeFilteredRun.payload.result.corpusPlan.documents[0].windowPlan.windows.every((window) => window.timeRange?.from === "2026-06-15"), true);
  assert.equal(timeFilteredRun.payload.result.candidates.some((candidate) => candidate.sourceIds.includes("container-time-may")), false);
  assert.equal(timeFilteredRun.payload.result.agentMessage.corpusPlan.timeFilter.matchedSourceIds.includes("container-time-june"), true);

  const mountedLegacyRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container mounted legacy Office filePath verification",
      title: "Container mounted legacy Office filePath verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-mounted-legacy-doc",
          title: "Container Mounted Legacy DOC",
          fileName: "mounted-legacy-large.doc",
          mediaType: "application/msword",
          filePath: "/data/mounted-legacy-large.doc"
        },
        {
          sourceId: "container-mounted-legacy-rtf",
          title: "Container Mounted RTF",
          fileName: "mounted-notes.rtf",
          mediaType: "application/rtf",
          filePath: "/data/mounted-notes.rtf"
        },
        {
          sourceId: "container-mounted-legacy-ppt",
          title: "Container Mounted Legacy PPT",
          fileName: "mounted-legacy.ppt",
          mediaType: "application/vnd.ms-powerpoint",
          filePath: "/data/mounted-legacy.ppt"
        },
        {
          sourceId: "container-mounted-legacy-xls",
          title: "Container Mounted Legacy XLS",
          fileName: "mounted-legacy.xls",
          mediaType: "application/vnd.ms-excel",
          filePath: "/data/mounted-legacy.xls"
        },
        {
          sourceId: "container-mounted-msg",
          title: "Container Mounted Outlook MSG",
          fileName: "mounted-outlook.msg",
          mediaType: "application/vnd.ms-outlook",
          filePath: "/data/mounted-outlook.msg"
        }
      ],
      maxWindowCharacters: 8000,
      windowOverlapCharacters: 400
    })
  });
  assert.equal(mountedLegacyRun.status, 201);
  assert.equal(mountedLegacyRun.payload.status, "completed");
  for (const [sourceId, formatId, tikaStage] of [
    ["container-mounted-legacy-doc", "word", "tika.text.file-ref"],
    ["container-mounted-legacy-rtf", "word", "tika.text.file-ref"],
    ["container-mounted-legacy-ppt", "presentation", "tika.text.file-ref"],
    ["container-mounted-legacy-xls", "spreadsheet", "tika.text.file-ref"],
    ["container-mounted-msg", "email", "email.msg.tika.file-ref"]
  ]) {
    const mountedLegacy = mountedLegacyRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === sourceId);
    assert.ok(mountedLegacy, `${sourceId} must be present in mounted legacy corpus`);
    assert.equal(mountedLegacy.route.formatId, formatId);
    assert.equal(mountedLegacy.quality.suppliedPayloadKind, "file-ref-tika");
    assert.equal(mountedLegacy.windowPlan.strategy, "file-ref-stream-windowing.v1");
    assert.equal(mountedLegacy.parserTrace.some((trace) => trace.stage === "payload.file-ref" && trace.status === "completed"), true);
    assert.equal(mountedLegacy.parserTrace.some((trace) => trace.stage === tikaStage && trace.status === "completed"), true);
    assert.equal(mountedLegacy.parserTrace.some((trace) => trace.stage === "payload.stream-text" && trace.status === "completed"), true);
    assert.equal(mountedLegacy.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);
    assert.ok(mountedLegacy.quality.textCharacters > 0, `${sourceId} must produce distillable text`);
  }

  const deferredFilePathRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container oversized filePath deferral verification",
      title: "Container oversized filePath deferral verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-deferred-file-ref",
          title: "Container Deferred File Ref",
          fileName: "oversized-binary.pdf",
          mediaType: "application/pdf",
          filePath: "/data/oversized-binary.pdf"
        }
      ]
    })
  });
  assert.equal(deferredFilePathRun.status, 201);
  assert.equal(deferredFilePathRun.payload.status, "failed");
  const deferredFileRef = deferredFilePathRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-deferred-file-ref");
  assert.ok(deferredFileRef, "oversized binary filePath source must remain visible in corpus");
  assert.equal(deferredFileRef.route.formatId, "pdf");
  assert.equal(deferredFileRef.parserTrace.some((trace) => trace.stage === "pdf.text.pdftotext" && trace.status === "failed"), true);
  assert.equal(deferredFileRef.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);

  const binaryProfileRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container oversized unknown binary profile verification",
      title: "Container oversized unknown binary profile verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-binary-profile-file-ref",
          title: "Container Binary Profile File Ref",
          fileName: "oversized-unknown.asset",
          mediaType: "application/octet-stream",
          filePath: "/data/oversized-unknown.asset"
        }
      ]
    })
  });
  assert.equal(binaryProfileRun.status, 201);
  assert.equal(binaryProfileRun.payload.status, "failed");
  const binaryProfileFileRef = binaryProfileRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-binary-profile-file-ref");
  assert.ok(binaryProfileFileRef, "oversized unknown filePath source must remain visible in corpus");
  assert.equal(binaryProfileFileRef.route.formatId, "unknown");
  assert.equal(binaryProfileFileRef.quality.suppliedPayloadKind, "file-ref-binary-profile");
  assert.equal(/^sha256:[a-f0-9]{64}$/.test(binaryProfileFileRef.contentHash), true);
  assert.equal(binaryProfileFileRef.parserTrace.some((trace) => (
    trace.stage === "payload.file-ref-binary-profile" &&
    trace.strategy === "bounded-binary-file-profile.v1" &&
    trace.directReadAvoided === true &&
    trace.hashedBytes === binaryProfileFileRef.byteSize &&
    trace.sampleBytes > 0
  )), true);
  assert.equal(binaryProfileFileRef.parserTrace.some((trace) => trace.stage === "payload.file-ref-deferred"), false);

  const attachedPackageBytes = zipSync({
    "mail/decision.md": strToU8("# Mail Decision\nEmail attachment archive child evidence for project distillation."),
    "mail/payment.csv": strToU8("vendor,total\nMailCo,77")
  });
  const emailAttachmentRun = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Container email attachment recursive parser verification",
      title: "Container email attachment recursive parser verification",
      responseProfile: "agent",
      rawDocuments: [
        {
          sourceId: "container-email",
          title: "Container Email",
          fileName: "container-email.eml",
          mediaType: "message/rfc822",
          contentBase64: multipartEmailBase64({
            attachments: [
              {
                fileName: "mail-package.zip",
                mediaType: "application/zip",
                bytes: Buffer.from(attachedPackageBytes)
              }
            ]
          })
        }
      ]
    })
  });
  assert.equal(emailAttachmentRun.status, 201);
  assert.equal(emailAttachmentRun.payload.status, "completed");
  const emailParent = emailAttachmentRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-email");
  assert.ok(emailParent, "email parent must remain visible as the parent corpus document");
  assert.equal(emailParent.route.formatId, "email");
  assert.equal(emailParent.parserTrace.some((trace) => trace.stage === "email.attachment-route" && trace.status === "completed"), true);
  const zipAttachment = emailAttachmentRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-email!attachment:mail-package.zip");
  assert.ok(zipAttachment, "email ZIP attachment must be expanded");
  assert.equal(zipAttachment.parentSourceId, "container-email");
  assert.equal(zipAttachment.route.formatId, "archive");
  assert.equal(zipAttachment.parserTrace.some((trace) => trace.stage === "email.attachment" && trace.status === "expanded"), true);
  const mailDecisionChild = emailAttachmentRun.payload.result.corpusPlan.documents.find((item) => item.sourceId === "container-email!attachment:mail-package.zip!mail/decision.md");
  assert.ok(mailDecisionChild, "email ZIP attachment Markdown child must be recursively expanded");
  assert.equal(mailDecisionChild.parentSourceId, "container-email!attachment:mail-package.zip");
  assert.equal(mailDecisionChild.route.formatId, "markdown");
  assert.equal(mailDecisionChild.parserTrace.some((trace) => trace.stage === "text.markdown" && trace.status === "completed"), true);
} catch (error) {
  if (started) {
    const logs = await docker(["logs", containerName]).catch(() => ({ stdout: "", stderr: "" }));
    if (logs.stdout || logs.stderr) {
      console.error([logs.stdout, logs.stderr].filter(Boolean).join("\n"));
    }
  }
  throw error;
} finally {
  if (started) {
    await docker(["rm", "-f", containerName]).catch(() => {});
  }
}

console.log("external knowledge distillation container verification passed");
