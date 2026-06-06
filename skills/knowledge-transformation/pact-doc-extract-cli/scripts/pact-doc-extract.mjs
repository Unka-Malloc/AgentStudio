#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  pact-doc-extract.mjs --repo /path/to/Pact --input file.pdf --format json|txt|md [--output out]",
    "",
    "Options:",
    "  --data-dir   Temp data dir. Defaults to <repo>/.pact-skill-data",
    "  --tika-jar   Override PACT_TIKA_JAR_PATH for this run",
    "  --java-bin   Override PACT_JAVA_BIN_PATH for this run"
  ].join("\n");
}

function markdownFor(document, inputPath) {
  const lines = [
    `# ${path.basename(inputPath)}`,
    "",
    "## Metadata",
    "",
    "```json",
    JSON.stringify(document.metadata || {}, null, 2),
    "```",
    "",
    "## Text",
    "",
    document.text || ""
  ];

  if (Array.isArray(document.embeddedDocuments) && document.embeddedDocuments.length > 0) {
    lines.push("", "## Embedded Documents", "");
    for (const embedded of document.embeddedDocuments) {
      lines.push(`### ${embedded.id || "embedded"}`, "", embedded.text || "", "");
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const repo = path.resolve(String(args.repo || process.cwd()));
  const inputPath = path.resolve(String(args.input));
  const format = String(args.format || "json").toLowerCase();
  const userDataPath = path.resolve(String(args["data-dir"] || path.join(repo, ".pact-skill-data")));

  if (!["json", "txt", "md"].includes(format)) {
    throw new Error(`Unsupported format: ${format}`);
  }

  const tikaModulePath = path.join(repo, "server/platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs");
  const { extractDocumentWithTika } = await import(pathToFileURL(tikaModulePath).href);
  const settings = {
    tikaJarPath: typeof args["tika-jar"] === "string" ? args["tika-jar"] : "",
    javaBinPath: typeof args["java-bin"] === "string" ? args["java-bin"] : ""
  };
  const document = await extractDocumentWithTika({
    filePath: inputPath,
    fileName: path.basename(inputPath),
    settings,
    userDataPath
  });

  let output;
  if (format === "txt") {
    output = `${document.text || ""}\n`;
  } else if (format === "md") {
    output = markdownFor(document, inputPath);
  } else {
    output = JSON.stringify(
      {
        inputPath,
        parserId: document.parserId || "builtin/tika",
        metadata: document.metadata || {},
        text: document.text || "",
        embeddedDocuments: document.embeddedDocuments || []
      },
      null,
      2
    );
  }

  if (args.output) {
    const outputPath = path.resolve(String(args.output));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, output, "utf8");
    console.log(outputPath);
  } else {
    process.stdout.write(output);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
