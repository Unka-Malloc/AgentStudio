#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  collectDeploymentIndexPaths,
  DEPLOYMENT_INDEX_RELATIVE_PATH,
  loadDeploymentIndex,
  REPO_ROOT
} from "./deployment-index.mjs";

function assertString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim(), `${label} must not be empty`);
}

function assertIncludes(text, needle, label) {
  assert.ok(text.includes(needle), `${label} must include ${needle}`);
}

function commandValue(command, flag) {
  const index = command.indexOf(flag);
  return index >= 0 ? command[index + 1] : undefined;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, relativePath), "utf8"));
}

async function assertPathExists(relativePath, label) {
  await fs.stat(path.join(REPO_ROOT, relativePath)).catch((error) => {
    throw new Error(`${label} path does not exist: ${relativePath} (${error.message})`);
  });
}

const index = await loadDeploymentIndex();
assert.equal(index.schemaVersion, "v0.0.1:schema:definition-1", "deployment index schemaVersion must be v0.0.1:schema:definition-1");
assert.equal(index.kind, "pact.deployment.entry-index", "deployment index kind mismatch");
assert.ok(Array.isArray(index.agentDisclosure?.openOrder), "agentDisclosure.openOrder must be an array");

for (const entry of collectDeploymentIndexPaths(index)) {
  await assertPathExists(entry.path, entry.id);
}

const docker = index.dockerPresets;
const mainService = docker?.mainService;
const runtime = mainService?.runtime;
assertString(docker?.baseImages?.mainService, "dockerPresets.baseImages.mainService");
assertString(docker?.baseImages?.runtimeDownloadService, "dockerPresets.baseImages.runtimeDownloadService");
assertString(docker?.npmRegistry, "dockerPresets.npmRegistry");
assertString(mainService?.dockerfile, "dockerPresets.mainService.dockerfile");
assertString(runtime?.dataPath, "dockerPresets.mainService.runtime.dataPath");
assertString(runtime?.host, "dockerPresets.mainService.runtime.host");
assert.equal(Number.isInteger(runtime?.port), true, "dockerPresets.mainService.runtime.port must be an integer");
assert.equal(runtime?.command?.[0], "node", "main service command must start with node");
assert.equal(commandValue(runtime.command, "--data-dir"), runtime.dataPath, "main service command data path must match preset");
assert.equal(Number(commandValue(runtime.command, "--port")), runtime.port, "main service command port must match preset");
assert.equal(commandValue(runtime.command, "--host"), runtime.host, "main service command host must match preset");

const dockerfileText = await fs.readFile(path.join(REPO_ROOT, mainService.dockerfile), "utf8");
assertIncludes(dockerfileText, `ARG NODE_BASE_IMAGE=${docker.baseImages.mainService}`, "Dockerfile");
assertIncludes(dockerfileText, `ARG NPM_REGISTRY=${docker.npmRegistry}`, "Dockerfile");
assertIncludes(dockerfileText, `ARG JRE_VERSION=${mainService.buildArgs.JRE_VERSION}`, "Dockerfile");
assertIncludes(dockerfileText, `ARG TIKA_VERSION=${mainService.buildArgs.TIKA_VERSION}`, "Dockerfile");
assertIncludes(dockerfileText, `RUN mkdir -p ${runtime.dataPath}`, "Dockerfile");
assertIncludes(dockerfileText, `EXPOSE ${runtime.port}`, "Dockerfile");
assertIncludes(dockerfileText, `VOLUME ["${runtime.dataPath}"]`, "Dockerfile");
assert.equal(/PACT_SERVER_DATA_DIR=/.test(dockerfileText), false, "Dockerfile must not set PACT_SERVER_DATA_DIR");
assert.equal(/PACT_ALLOW_PUBLIC_CONSOLE=/.test(dockerfileText), false, "Dockerfile must not set PACT_ALLOW_PUBLIC_CONSOLE");

const cmdMatch = dockerfileText.match(/^CMD\s+(\[[^\n]+\])$/m);
assert.ok(cmdMatch, "Dockerfile must define JSON-array CMD");
const dockerCmd = JSON.parse(cmdMatch[1]);
assert.deepEqual(dockerCmd, runtime.command, "Dockerfile CMD must match deployment index runtime command");

const runtimeDeps = index.runtimeDependencies;
assertString(runtimeDeps?.service?.script, "runtimeDependencies.service.script");
assertString(runtimeDeps?.service?.containerDataPath, "runtimeDependencies.service.containerDataPath");
assertString(runtimeDeps?.service?.nodeImage, "runtimeDependencies.service.nodeImage");
assert.ok(Array.isArray(runtimeDeps?.targets), "runtimeDependencies.targets must be an array");
for (const target of ["jre", "python", "node", "caddy", "gerrit"]) {
  assert.ok(runtimeDeps.targets.some((entry) => entry.id === target), `runtimeDependencies.targets must include ${target}`);
}

const dockerBakedSettings = await readJson(runtimeDeps.dockerBaked.defaultSettingsPath);
assert.equal(dockerBakedSettings.javaBinPath, runtimeDeps.dockerBaked.javaBinPath, "runtime default-settings javaBinPath must match index");
assert.equal(dockerBakedSettings.tikaJarPath, runtimeDeps.dockerBaked.tikaJarPath, "runtime default-settings tikaJarPath must match index");

const runtimeDownloadSource = await fs.readFile(path.join(REPO_ROOT, runtimeDeps.service.script), "utf8");
assertIncludes(runtimeDownloadSource, "loadDeploymentIndex", "runtime download container script");
assertIncludes(runtimeDownloadSource, "runtimeDownloadPreset.containerDataPath", "runtime download container script");
assertIncludes(runtimeDownloadSource, "runtimeDownloadPreset.nodeImage", "runtime download container script");

const deploymentFlowSource = await fs.readFile(path.join(REPO_ROOT, "server/scripts/verify-deployment-container-flow.mjs"), "utf8");
assertIncludes(deploymentFlowSource, "loadDeploymentIndex", "deployment container flow verifier");
assertIncludes(deploymentFlowSource, "mainServicePreset?.runtime?.dataPath", "deployment container flow verifier");

const externalServices = index.externalServices?.services || [];
assert.ok(externalServices.length >= 2, "externalServices.services must include RAG and knowledge distillation services");
const ragService = externalServices.find((service) => service.id === "rag-service");
const kdService = externalServices.find((service) => service.id === "knowledge-distillation-service");
assert.ok(ragService, "externalServices.services must include rag-service");
assert.ok(kdService, "externalServices.services must include knowledge-distillation-service");

const ragDockerfileText = await fs.readFile(path.join(REPO_ROOT, ragService.dockerfile), "utf8");
assertIncludes(ragDockerfileText, `ARG NODE_BASE_IMAGE=${docker.baseImages.externalHttpService}`, "RAG Dockerfile");
assertIncludes(ragDockerfileText, `ENV PORT=${ragService.port}`, "RAG Dockerfile");
assertIncludes(ragDockerfileText, `EXPOSE ${ragService.port}`, "RAG Dockerfile");
assertIncludes(ragDockerfileText, ragService.healthPath, "RAG Dockerfile");

const ragConfig = await readJson(ragService.config);
assert.equal(ragConfig.serviceId, ragService.id, "RAG external service config serviceId must match index");
assert.equal(ragConfig.docker?.dockerfile, ragService.dockerfile, "RAG external service config dockerfile must match index");
assertIncludes(ragConfig.upstream?.url || "", `:${ragService.port}`, "RAG upstream URL");
assertIncludes(ragConfig.healthCheck?.url || "", `:${ragService.port}${ragService.healthPath}`, "RAG health URL");

const kdDockerfileText = await fs.readFile(path.join(REPO_ROOT, kdService.dockerfile), "utf8");
assertIncludes(kdDockerfileText, `ENV PORT=${kdService.port}`, "knowledge distillation Dockerfile");
assertIncludes(kdDockerfileText, `ENV SERVICE_DATA_DIR=${kdService.dataPath}`, "knowledge distillation Dockerfile");
assertIncludes(kdDockerfileText, `EXPOSE ${kdService.port}`, "knowledge distillation Dockerfile");
assertIncludes(kdDockerfileText, kdService.healthPath, "knowledge distillation Dockerfile");

const packageJson = await readJson("package.json");
assert.equal(packageJson.scripts?.["server:deployment-index"], "node server/scripts/deployment-index.mjs", "package script server:deployment-index mismatch");
assert.equal(packageJson.scripts?.["server:verify:deployment-index"], "node server/scripts/verify-deployment-index.mjs", "package script server:verify:deployment-index mismatch");

console.log(JSON.stringify({
  ok: true,
  index: DEPLOYMENT_INDEX_RELATIVE_PATH,
  checkedPaths: collectDeploymentIndexPaths(index).length,
  mainService: {
    dockerfile: mainService.dockerfile,
    dataPath: runtime.dataPath,
    port: runtime.port
  },
  externalServices: externalServices.map((service) => service.id)
}, null, 2));
