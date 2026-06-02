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
    "  pact-module-contract-test.mjs --module ./my-mount.mjs --mount-name documentParser",
    "",
    "Options:",
    "  --repo PATH           Used as runtime cwd. Defaults to current directory",
    "  --data-dir PATH       Defaults to <repo>/.pact-skill-data",
    "  --sample PATH         Optional sample file",
    "  --action extractDocument|extractText|analysis|postCommit"
  ].join("\n");
}

async function loadMount({ modulePath, mountName, repo, dataDir }) {
  const resolvedPath = path.isAbsolute(modulePath) ? modulePath : path.resolve(repo, modulePath);
  const moduleUrl = new URL(pathToFileURL(resolvedPath).href);
  moduleUrl.searchParams.set("mount_generation", String(Date.now()));
  const loaded = await import(moduleUrl.href);
  const factory =
    loaded.createMount ||
    loaded.default ||
    loaded[`create${mountName.slice(0, 1).toUpperCase()}${mountName.slice(1)}Mount`];

  const instance =
    typeof factory === "function"
      ? await factory({
          mountName,
          userDataPath: dataDir,
          runtimeOptions: {
            cwd: repo,
            mountModules: {
              [mountName]: resolvedPath
            },
            mountRouting: {}
          }
        })
      : loaded;

  if (!instance || typeof instance !== "object") {
    throw new Error("Module did not return a mount object");
  }
  return instance;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.module || !args["mount-name"]) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const repo = path.resolve(String(args.repo || process.cwd()));
  const dataDir = path.resolve(String(args["data-dir"] || path.join(repo, ".pact-skill-data")));
  await fs.mkdir(dataDir, { recursive: true });

  const mountName = String(args["mount-name"]);
  const mount = await loadMount({
    modulePath: String(args.module),
    mountName,
    repo,
    dataDir
  });

  const report = {
    mountName,
    id: mount.id || "",
    kind: mount.kind || mountName,
    enabled: mount.enabled !== false,
    capabilities: {
      supports: typeof mount.supports === "function",
      extractDocument: typeof mount.extractDocument === "function",
      extractText: typeof mount.extractText === "function",
      onBatchCompleted: typeof mount.onBatchCompleted === "function",
      reload: typeof mount.reload === "function",
      close: typeof mount.close === "function",
      listModules: typeof mount.listModules === "function",
      listAlgorithms: typeof mount.listAlgorithms === "function",
      runModule: typeof mount.runModule === "function",
      runAnalysis: typeof mount.runAnalysis === "function"
    },
    checks: []
  };

  function check(name, ok, details = "") {
    report.checks.push({ name, ok: Boolean(ok), details });
  }

  check("object", true, "module returned mount object");
  if (typeof mount.reload === "function") {
    await mount.reload({ settings: {}, mountName, runtimeOptions: { cwd: repo } });
    check("reload", true);
  }

  if (typeof mount.supports === "function" && args.sample) {
    const samplePath = path.resolve(String(args.sample));
    const supported = await mount.supports({
      extension: path.extname(samplePath).toLowerCase(),
      mediaTypeHint: "",
      sourceKind: ""
    });
    check("supports sample", supported !== false, String(supported));
  }

  const action = String(args.action || "");
  if (args.sample && (action === "extractDocument" || action === "extractText" || !action)) {
    const samplePath = path.resolve(String(args.sample));
    const input = {
      filePath: samplePath,
      fileName: path.basename(samplePath),
      settings: {},
      userDataPath: dataDir
    };
    if ((action === "extractText" || (!action && !mount.extractDocument)) && typeof mount.extractText === "function") {
      const text = await mount.extractText(input);
      check("extractText", typeof text === "string" || typeof text?.text === "string", `type=${typeof text}`);
    } else if (typeof mount.extractDocument === "function") {
      const document = await mount.extractDocument(input);
      check("extractDocument parserId", Boolean(document?.parserId), document?.parserId || "");
      check("extractDocument text", typeof document?.text === "string", `text=${String(document?.text || "").length}`);
    }
  }

  if (action === "analysis" && (mount.runModule || mount.runAnalysis)) {
    const run = mount.runModule || mount.runAnalysis;
    const output = await run({
      moduleId: "contract-test",
      algorithmId: "contract-test",
      sources: [],
      chunks: [],
      settings: {}
    });
    check("analysis run", Boolean(output), typeof output);
  }

  if (action === "postCommit" && typeof mount.onBatchCompleted === "function") {
    await mount.onBatchCompleted({
      batchId: "contract-test",
      jobId: "contract-test",
      result: { sourceFiles: [], chunks: [] },
      settings: {}
    });
    check("postCommit", true);
  }

  if (typeof mount.close === "function") {
    await mount.close();
    check("close", true);
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some((item) => !item.ok)) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
