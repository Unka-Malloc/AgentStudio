#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
export const DEPLOYMENT_INDEX_RELATIVE_PATH = "server/config/deployment/index.json";
export const DEPLOYMENT_INDEX_PATH = path.join(REPO_ROOT, DEPLOYMENT_INDEX_RELATIVE_PATH);

export async function loadDeploymentIndex({ cwd = REPO_ROOT } = {}) {
  const filePath = path.resolve(cwd, DEPLOYMENT_INDEX_RELATIVE_PATH);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function deploymentIndexSection(index, sectionPath = "") {
  if (!sectionPath) return index;
  let current = index;
  for (const segment of String(sectionPath).split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new Error(`Deployment index section not found: ${sectionPath}`);
    }
    current = current[segment];
  }
  return current;
}

export function collectDeploymentIndexPaths(index) {
  const paths = new Map();
  const add = (id, filePath) => {
    if (!filePath || typeof filePath !== "string") return;
    if (filePath.startsWith("/") || filePath.startsWith("${")) return;
    paths.set(id, filePath);
  };

  for (const entry of index.agentDisclosure?.openOrder || []) {
    add(`agent:${entry.id}`, entry.path);
  }
  add("docker:main-service", index.dockerPresets?.mainService?.dockerfile);
  add("runtime:download-service", index.runtimeDependencies?.service?.script);
  add("runtime:example-config", index.runtimeDependencies?.exampleConfig);
  add("runtime:default-settings", index.runtimeDependencies?.dockerBaked?.defaultSettingsPath);
  add("external:registry", index.externalServices?.discovery?.registry);
  for (const service of index.externalServices?.services || []) {
    add(`external:${service.id}:dockerfile`, service.dockerfile);
    add(`external:${service.id}:config`, service.config);
  }
  return [...paths.entries()].map(([id, filePath]) => ({ id, path: filePath }));
}

function summaryFor(index) {
  return {
    schemaVersion: index.schemaVersion,
    kind: index.kind,
    startHere: DEPLOYMENT_INDEX_RELATIVE_PATH,
    docker: {
      dockerfile: index.dockerPresets?.mainService?.dockerfile,
      nodeBaseImage: index.dockerPresets?.baseImages?.mainService,
      dataPath: index.dockerPresets?.mainService?.runtime?.dataPath,
      port: index.dockerPresets?.mainService?.runtime?.port
    },
    runtimeDownloads: {
      script: index.runtimeDependencies?.service?.script,
      containerDataPath: index.runtimeDependencies?.service?.containerDataPath,
      nodeImage: index.runtimeDependencies?.service?.nodeImage,
      targets: (index.runtimeDependencies?.targets || []).map((target) => target.id)
    },
    externalServices: (index.externalServices?.services || []).map((service) => ({
      id: service.id,
      dockerfile: service.dockerfile,
      config: service.config || null,
      port: service.port,
      healthPath: service.healthPath
    })),
    validation: index.validation
  };
}

function usage() {
  return [
    "Usage:",
    "  node server/scripts/deployment-index.mjs [summary]",
    "  node server/scripts/deployment-index.mjs show",
    "  node server/scripts/deployment-index.mjs section <path>",
    "  node server/scripts/deployment-index.mjs paths",
    "",
    "Examples:",
    "  npm run server:deployment-index",
    "  npm run server:deployment-index -- section dockerPresets.mainService",
    "  npm run server:deployment-index -- paths"
  ].join("\n");
}

async function main() {
  const [command = "summary", sectionPath = ""] = process.argv.slice(2);
  if (command === "--help" || command === "help") {
    console.log(usage());
    return;
  }

  const index = await loadDeploymentIndex();
  if (command === "summary") {
    console.log(JSON.stringify(summaryFor(index), null, 2));
    return;
  }
  if (command === "show") {
    console.log(JSON.stringify(index, null, 2));
    return;
  }
  if (command === "section") {
    console.log(JSON.stringify(deploymentIndexSection(index, sectionPath), null, 2));
    return;
  }
  if (command === "paths") {
    console.log(JSON.stringify(collectDeploymentIndexPaths(index), null, 2));
    return;
  }
  throw new Error(`Unknown deployment-index command: ${command}\n${usage()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
