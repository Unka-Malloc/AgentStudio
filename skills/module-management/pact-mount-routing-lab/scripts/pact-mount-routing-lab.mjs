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
    "  pact-mount-routing-lab.mjs --repo /path/to/Pact --extension .pdf --kind document",
    "",
    "Options:",
    "  --data-dir PATH       Defaults to ServerConfig.getDataDir()",
    "  --media-type VALUE    Optional media type hint",
    "  --routing JSON        Runtime routing patch JSON",
    "  --modules JSON        Runtime module path map JSON"
  ].join("\n");
}

async function resolveDataDir(repo, args) {
  if (args["data-dir"]) {
    return path.resolve(String(args["data-dir"]));
  }

  const serverConfigPath = path.join(repo, "server/platform/common/config/ServerConfig.mjs");
  try {
    const { ServerConfig } = await import(pathToFileURL(serverConfigPath).href);
    if (typeof ServerConfig?.getDataDir === "function") {
      return path.resolve(ServerConfig.getDataDir());
    }
  } catch {
    // Legacy checkouts may not expose Pact's ServerConfig yet.
  }

  return path.resolve(process.env.PACT_SERVER_DATA_DIR || path.join(process.env.HOME || process.cwd(), ".pact-server-data"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const repo = path.resolve(String(args.repo || process.cwd()));
  const dataDir = await resolveDataDir(repo, args);
  await fs.mkdir(dataDir, { recursive: true });
  const managerPath = path.join(repo, "server/platform/common/module-manager/mount-manager.mjs");
  const { createMountManager } = await import(pathToFileURL(managerPath).href);
  const manager = await createMountManager({
    userDataPath: dataDir,
    runtimeOptions: {
      cwd: repo,
      mountModules: args.modules ? JSON.parse(String(args.modules)) : {},
      mountRouting: args.routing ? JSON.parse(String(args.routing)) : {}
    }
  });

  try {
    const execution = manager.createExecutionView();
    const route = execution.resolveDocumentRoute({
      sourceKind: String(args.kind || ""),
      extension: String(args.extension || ""),
      mediaTypeHint: String(args["media-type"] || "")
    });
    console.log(
      JSON.stringify(
        {
          input: {
            sourceKind: String(args.kind || ""),
            extension: String(args.extension || ""),
            mediaTypeHint: String(args["media-type"] || "")
          },
          route,
          configuredMounts: Object.fromEntries(
            Object.entries(execution.mounts || {}).map(([name, mount]) => [
              name,
              {
                id: mount?.id || "",
                kind: mount?.kind || name,
                enabled: mount?.enabled !== false,
                hasExtractDocument: typeof mount?.extractDocument === "function",
                hasExtractText: typeof mount?.extractText === "function",
                hasPostCommitHook: typeof mount?.onBatchCompleted === "function"
              }
            ])
          )
        },
        null,
        2
      )
    );
  } finally {
    await manager.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
