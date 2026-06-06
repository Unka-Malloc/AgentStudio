#!/usr/bin/env node
import {
  downloadRuntimeDependency,
  listRuntimeDependencies
} from "../../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

const TARGET_ALIASES = new Map([
  ["document-runtime", "jre"],
  ["gerrit-war", "gerrit"],
  ["gateway-caddy", "caddy"],
  ["gateway-nginx", "nginx"],
  ["ocr-python", "python"],
  ["pdf-visual-python", "python"],
  ["ragflow", "rag-flow"],
  ["language-runtimes", "programming-runtimes"]
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const raw = item.slice(2);
    const equalIndex = raw.indexOf("=");
    if (equalIndex >= 0) {
      args[raw.slice(0, equalIndex)] = raw.slice(equalIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[raw] = next;
      index += 1;
    } else {
      args[raw] = true;
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs list [--json]
  node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target all|dify|rag-flow|cloud-drives|docker|programming-runtimes|jre|python|caddy|nginx|gerrit [--dry-run]
`);
}

function normalizeTarget(target = "") {
  const id = String(target || "").trim();
  return TARGET_ALIASES.get(id) || id;
}

function markdownTable(dependencies = []) {
  const rows = [
    "| Target | Capability | Status | Download action | Source policy |",
    "| --- | --- | --- | --- | --- |",
    ...dependencies.map((item) => {
      const action = item.actions?.download || "";
      const policy = item.detection?.sourcePolicy || "";
      return `| \`${item.id}\` | ${item.description || item.label} | ${item.status} | ${action} | ${policy} |`;
    })
  ];
  return `${rows.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "list";
  if (args.help || command === "help") {
    printUsage();
    return;
  }

  if (command === "list") {
    const list = await listRuntimeDependencies();
    if (args.json) {
      console.log(JSON.stringify(list, null, 2));
    } else {
      process.stdout.write(markdownTable(list.dependencies || []));
    }
    return;
  }

  if (command === "download") {
    const targetId = normalizeTarget(args.target);
    if (!targetId) {
      throw new Error("download requires --target.");
    }
    const result = await downloadRuntimeDependency({
      targetId,
      dryRun: args["dry-run"] === true || args.dryRun === true
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
