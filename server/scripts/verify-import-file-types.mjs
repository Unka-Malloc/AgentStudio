import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  createFileRoutingDecision,
  isSupportedImportFilePath,
  isSupportedImportPath
} from "../platform/specialized/knowledge/preprocessing/file-processor/index.mjs";
import {
  getImportDefaultRoutingTable,
  getImportExtensionRoutes,
  getImportMediaTypeRoutes,
  importFileDescriptorForPath,
  importFileTypeConfigPath,
  reloadImportFileTypeRegistry
} from "../platform/specialized/knowledge/preprocessing/file-processor/import-file-types.mjs";
import { TIKA_IMPORT_EXTENSIONS } from "../platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs";
import { normalizeMountRouting } from "../platform/common/module-manager/mount-config.mjs";

const configPath = importFileTypeConfigPath();
assert.ok(configPath.endsWith("default-import-file-types.json"));

const defaultRoutingTable = getImportDefaultRoutingTable();
const extensionRoutes = getImportExtensionRoutes();
const mediaTypeRoutes = getImportMediaTypeRoutes();
assert.equal(defaultRoutingTable.extensionRoutes[".pdf"]?.mountName, "pdfProcessor");
assert.equal(defaultRoutingTable.mediaTypeRoutes["application/pdf"]?.mountName, "pdfProcessor");
assert.equal(defaultRoutingTable.kindRoutes.image?.mountName, "ocr");
assert.equal(mediaTypeRoutes["application/pdf"]?.mountName, "pdfProcessor");
for (const filePath of [
  "src/main.rs",
  "src/app.swift",
  "cmd/server.go",
  "frontend/App.vue",
  "Dockerfile",
  "slides/product-roadmap.pptx",
  "docs/briefing.pdf",
  "notes/research.md"
]) {
  assert.ok(
    isSupportedImportPath(filePath),
    `${filePath} should be accepted by the import file type dictionary`
  );
}

assert.equal(importFileDescriptorForPath("Dockerfile")?.kind, "text");
assert.equal(importFileDescriptorForPath("slides/product-roadmap.pptx")?.normalizedAdapter, "presentation");
assert.equal(importFileDescriptorForPath("docs/briefing.pdf")?.route?.mountName, "pdfProcessor");
assert.equal(extensionRoutes[".rs"]?.mountName, "documentParser");
assert.ok(TIKA_IMPORT_EXTENSIONS.includes("pptx"));
assert.ok(TIKA_IMPORT_EXTENSIONS.includes("pdf"));

const routing = normalizeMountRouting();
assert.equal(routing.extensionRoutes[".go"]?.mountName, "documentParser");
assert.equal(routing.extensionRoutes[".pdf"]?.mountName, "pdfProcessor");
assert.equal(routing.mediaTypeRoutes["application/pdf"]?.mountName, "pdfProcessor");

const mountConfigText = await fs.readFile(
  path.resolve("server/platform/common/module-manager/mount-config.mjs"),
  "utf8"
);
assert.ok(
  mountConfigText.includes("getImportDefaultRoutingTable"),
  "mount routing defaults must come from the singleton import file type registry"
);
assert.equal(
  mountConfigText.includes("readFileSync"),
  false,
  "mount-config must not re-read the import file type JSON outside the singleton registry"
);

const fileProcessorText = await fs.readFile(
  path.resolve("server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs"),
  "utf8"
);
assert.ok(
  fileProcessorText.includes("getImportDefaultRoutingTable"),
  "file processor fallback routing must query the singleton import file type registry"
);
assert.equal(
  /sourceKind\s*===\s*["']image["'][\s\S]{0,180}mountName:\s*["']ocr["']/.test(fileProcessorText),
  false,
  "file processor must not hard-code the image-to-OCR route"
);

const markdownRouting = createFileRoutingDecision({
  buffer: Buffer.from("# Baseline\n\nDate: 2026-05-30\n\nMarkdown body.", "utf8"),
  fileName: "KNOWLEDGE-DISTILLATION-IMPLEMENTATION-BASELINE.md",
  mediaTypeHint: "message/rfc822"
});
assert.equal(markdownRouting.extension, ".md");
assert.equal(markdownRouting.kind, "text");
assert.equal(markdownRouting.mediaTypeHint, "text/plain");
assert.equal(markdownRouting.selectedSource, "declared-path");
assert.equal(
  markdownRouting.signals.some((signal) => signal.source === "text-sniff" && signal.extension === ".eml"),
  true,
  "routing trace should record weak email sniffing without selecting it"
);

const pdfRouting = createFileRoutingDecision({
  buffer: Buffer.from("%PDF-1.7\n% routed by signature\n", "utf8"),
  fileName: "wrong-extension.md"
});
assert.equal(pdfRouting.extension, ".pdf");
assert.equal(pdfRouting.kind, "pdf");
assert.equal(pdfRouting.selectedSource, "binary-signature");
assert.equal(pdfRouting.routedFileName, "wrong-extension.pdf");

const docxRouting = createFileRoutingDecision({
  buffer: Buffer.from(zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<w:document/>")
  })),
  fileName: "wrong-extension.zip"
});
assert.equal(docxRouting.extension, ".docx");
assert.equal(docxRouting.kind, "docx");
assert.equal(docxRouting.selectedSource, "zip-container");

const emailRouting = createFileRoutingDecision({
  buffer: Buffer.from("From: ops@example.test\nSubject: Routed\n\nBody", "utf8"),
  fileName: "upload"
});
assert.equal(emailRouting.extension, ".eml");
assert.equal(emailRouting.kind, "email");
assert.equal(emailRouting.selectedSource, "text-sniff");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-import-types-"));
try {
  const unknownTextPath = path.join(tempDir, "module.customlang");
  const disguisedPdfPath = path.join(tempDir, "briefing.custombin");
  const binaryPath = path.join(tempDir, "blob.custombin");
  await fs.writeFile(unknownTextPath, "fn main() {\n  return 42\n}\n", "utf8");
  await fs.writeFile(disguisedPdfPath, "%PDF-1.7\n% routed by signature\n", "utf8");
  await fs.writeFile(binaryPath, Buffer.from([0, 1, 2, 3, 4, 5, 0, 255]));
  assert.equal(await isSupportedImportFilePath(unknownTextPath), true);
  assert.equal(await isSupportedImportFilePath(disguisedPdfPath), true);
  assert.equal(await isSupportedImportFilePath(binaryPath), false);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

reloadImportFileTypeRegistry();
console.log("Import file type dictionary verification passed.");
