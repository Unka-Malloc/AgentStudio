import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dockerfile = path.join(workspaceRoot, "client-gui", "docker", "ubuntu-client.Dockerfile");
const image = process.env.PACT_UBUNTU_IMAGE || "pact-client-ubuntu:local";
const platform = process.env.PACT_UBUNTU_PLATFORM || "linux/amd64";
const guiArtifactDir = path.join(workspaceRoot, "build", "artifacts", "ubuntu-client-gui");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: workspaceRoot,
    stdio: "inherit",
    ...options,
  });
}

function main() {
  mkdirSync(guiArtifactDir, { recursive: true });

  if (process.env.PACT_UBUNTU_SKIP_IMAGE_BUILD !== "1") {
    run("docker", [
      "build",
      "--platform",
      platform,
      "-f",
      dockerfile,
      "-t",
      image,
      ".",
    ]);
  }

  const prepareWorkspace = [
    "mkdir -p /workspace",
    "&&",
    [
      "tar",
      "-C /source",
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=build",
      "--exclude=tests/fixtures",
      "--exclude=client-cli/target",
      "--exclude=client-gui/.dart_tool",
      "--exclude=client-gui/build",
      "-cf -",
      ".",
    ].join(" "),
    "|",
    "tar -C /workspace -xf -",
  ].join(" ");

  const verifyScript = [
    "set -euo pipefail",
    prepareWorkspace,
    "cd /workspace",
    "node --version",
    "rustc --version",
    "cargo --version",
    "flutter --version",
    "flutter doctor -v",
    "npm run client:get",
    "npm run client:analyze",
    "npm run client:test",
    "npm run client:native:test",
    "npm run client:build:linux",
    "npm run client:linux:smoke",
    "PACT_GUI_ARTIFACT_DIR=/artifacts npm run client:linux:gui-smoke",
  ].join(" && ");

  run("docker", [
    "run",
    "--rm",
    "--platform",
    platform,
    "--mount",
    `type=bind,src=${workspaceRoot},dst=/source,readonly`,
    "--mount",
    "type=volume,src=pact-ubuntu-pub-cache,dst=/root/.pub-cache",
    "--mount",
    "type=volume,src=pact-ubuntu-cargo-registry,dst=/root/.cargo/registry",
    "--mount",
    "type=volume,src=pact-ubuntu-cargo-git,dst=/root/.cargo/git",
    "--mount",
    "type=volume,src=pact-ubuntu-cargo-target,dst=/workspace/build/client-cli/target",
    "--mount",
    `type=bind,src=${guiArtifactDir},dst=/artifacts`,
    "-w",
    "/",
    image,
    "bash",
    "-lc",
    verifyScript,
  ]);
}

main();
