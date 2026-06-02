#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

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
    "  pact-result-export.mjs --repo /path/to/Pact --result-json result.json --format json|md --output out",
    "  pact-result-export.mjs --server-url http://127.0.0.1:8787 --job-id JOB --format json|md --output out",
    "",
    "DOCX:",
    "  Use `pact knowledge export-docx` for canonical knowledge export.",
    "  Use `pact jobs normalized-doc` for per-job normalized DOCX downloads."
  ].join("\n");
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function unwrapResult(payload) {
  if (payload && typeof payload === "object") {
    if (payload.payload && typeof payload.payload === "object" && "result" in payload.payload) {
      return payload.payload.result;
    }
    if ("result" in payload) {
      return payload.result;
    }
  }
  return payload;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function summarizeArray(items, title, lines) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }
  lines.push(`## ${title}`, "");
  for (const item of items.slice(0, 50)) {
    if (item && typeof item === "object") {
      const label = firstText(item.title, item.name, item.id, item.sourcePath, "item");
      const detail = firstText(item.summary, item.snippet, item.text, item.message);
      lines.push(`- ${label}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
    } else {
      lines.push(`- ${String(item).slice(0, 500)}`);
    }
  }
  lines.push("");
}

function markdownForResult(result, sourceLabel) {
  const lines = ["# Pact Job Result", "", `Source: ${sourceLabel}`, ""];
  if (result && typeof result === "object") {
    const summary = firstText(result.summary, result.message, result.status);
    if (summary) {
      lines.push("## Summary", "", summary, "");
    }
    summarizeArray(result.sourceFiles || result.sources, "Sources", lines);
    summarizeArray(result.documents || result.normalizedDocuments, "Documents", lines);
    summarizeArray(result.chunks, "Chunks", lines);
    summarizeArray(result.items || result.results, "Items", lines);
    lines.push("## Raw JSON", "", "```json", JSON.stringify(result, null, 2), "```", "");
    return lines.join("\n");
  }
  lines.push("```json", JSON.stringify(result, null, 2), "```", "");
  return lines.join("\n");
}

async function loadViaServer({ serverUrl, jobId }) {
  const baseUrl = normalizeBaseUrl(serverUrl);
  return unwrapResult(await fetchJson(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/result`));
}

async function loadLocally({ resultJsonPath }) {
  const raw = await fs.readFile(resultJsonPath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const format = String(args.format || "json").toLowerCase();
  if (!["json", "md"].includes(format)) {
    throw new Error(`Unsupported format: ${format}`);
  }
  if (!args.output) {
    throw new Error("--output is required");
  }

  let result;
  let sourceLabel;
  if (args["server-url"] && args["job-id"]) {
    result = await loadViaServer({
      serverUrl: String(args["server-url"]),
      jobId: String(args["job-id"])
    });
    sourceLabel = `${normalizeBaseUrl(args["server-url"])}/api/jobs/${args["job-id"]}/result`;
  } else if (args["result-json"]) {
    const resultJsonPath = path.resolve(String(args["result-json"]));
    result = await loadLocally({ resultJsonPath });
    sourceLabel = resultJsonPath;
  } else {
    console.log(usage());
    process.exit(1);
  }

  const output = format === "md"
    ? markdownForResult(result, sourceLabel)
    : `${JSON.stringify(result, null, 2)}\n`;
  const outputPath = path.resolve(String(args.output));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, "utf8");
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
