#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const defaultReportDir = path.join(repoRoot, "build", "test-reports");

const suites = [
  suite("repo.hygiene.pre", "Repository path hygiene", npm("run", "repo:hygiene"), [
    "repo",
    "hygiene",
    "regression",
    "security"
  ]),
  suite("security.secret-hygiene", "Static secret hygiene", node("tests/verify-secret-hygiene.mjs"), [
    "security",
    "hygiene",
    "regression"
  ]),
  suite("security.npm-audit", "Production dependency audit", npm("audit", "--audit-level=high", "--omit=dev"), [
    "security",
    "dependencies"
  ]),
  suite("server.web.build", "Server console renderer build", npm("run", "build:renderer:raw"), [
    "server",
    "web",
    "build",
    "regression"
  ]),
  suite("server.headless", "Headless server runtime", npm("run", "server:verify:headless"), [
    "server",
    "integration",
    "regression"
  ]),
  suite("server.mcp-http", "MCP HTTP single-entry-point rule and integrations", npm("run", "server:verify:mcp-http"), [
    "server",
    "mcp",
    "integration",
    "regression"
  ]),
  suite("server.continuity", "Transaction continuity", npm("run", "server:verify:continuity"), [
    "server",
    "integration",
    "regression"
  ]),
  suite("server.checkpoints", "Upload checkpoint lifecycle", npm("run", "server:verify:checkpoints"), [
    "server",
    "integration",
    "regression"
  ]),
  suite("server.rebuild", "Metadata rebuild", npm("run", "server:verify:rebuild"), [
    "server",
    "integration",
    "regression"
  ]),
  suite("server.ops", "Storage and ops tools", npm("run", "server:verify:ops"), [
    "server",
    "integration",
    "regression"
  ]),
  suite("server.knowledge", "Knowledge kernel", npm("run", "server:verify:knowledge"), [
    "server",
    "integration",
    "knowledge",
    "regression"
  ]),
  suite("server.knowledge-outline", "Knowledge document outline routing", npm("run", "server:verify:knowledge-outline"), [
    "server",
    "integration",
    "knowledge",
    "retrieval",
    "regression"
  ]),
  suite("server.operation-policy", "Operation policy and central audit", npm("run", "server:verify:operation-policy"), [
    "server",
    "security",
    "operation",
    "audit",
    "regression"
  ]),
  suite("server.dispatcher-unified", "Unified operation dispatcher guardrails", npm("run", "server:verify:dispatcher-unified"), [
    "server",
    "security",
    "operation",
    "dispatcher",
    "smoke",
    "regression"
  ]),
  suite("server.trace-context", "Trace context propagation", npm("run", "server:verify:trace-context"), [
    "server",
    "observability",
    "trace",
    "smoke",
    "regression"
  ]),
  suite("server.state-mutations", "State mutation dispatcher guardrails", npm("run", "server:verify:state-mutations"), [
    "server",
    "state",
    "concurrency",
    "smoke",
    "regression"
  ]),
  suite("server.console-auth", "Console authentication hardening", npm("run", "server:verify:console-auth"), [
    "server",
    "security",
    "auth",
    "regression"
  ]),
  suite("server.runtime-logging", "Runtime JSONL logging and retention", npm("run", "server:verify:runtime-logging"), [
    "server",
    "logging",
    "observability",
    "security",
    "smoke",
    "regression"
  ]),
  suite("server.context-compaction", "Context compaction runtime", npm("run", "server:verify:context-compaction"), [
    "server",
    "context",
    "compaction",
    "security",
    "regression"
  ]),
  suite("server.client-runtime-allocator", "Client runtime allocation", npm("run", "server:verify:client-runtime-allocator"), [
    "server",
    "context",
    "agent",
    "runtime",
    "regression"
  ]),
  suite("server.agent-gateway-compaction", "Agent gateway context compaction", npm("run", "server:verify:agent-gateway-compaction"), [
    "server",
    "agent",
    "context",
    "compaction",
    "regression"
  ]),
  suite("server.maintenance-agent-compaction", "Maintenance agent context compaction", npm("run", "server:verify:maintenance-agent-compaction"), [
    "server",
    "maintenance",
    "context",
    "compaction",
    "regression"
  ]),
  suite("server.entity-config-layout", "Human-maintainable entity config layout", npm("run", "server:verify:entity-config-layout"), [
    "server",
    "config",
    "knowledge",
    "tooling",
    "smoke",
    "regression"
  ]),
  suite("server.singleton-boundaries", "Singleton and cache boundary guardrails", npm("run", "server:verify:singleton-boundaries"), [
    "server",
    "config",
    "state",
    "concurrency",
    "smoke",
    "regression"
  ]),
  suite("server.source-evidence", "Source evidence preview and bounded indexing", npm("run", "server:verify:source-evidence"), [
    "server",
    "integration",
    "knowledge",
    "source",
    "memory",
    "regression"
  ]),
  suite("server.multi-source-connectors", "Multi-source local mirror and unified evidence", npm("run", "server:verify:multi-source-connectors"), [
    "server",
    "integration",
    "knowledge",
    "source",
    "connectors",
    "regression"
  ]),
  suite("server.external-service-api-registration", "External service API registration and internal algorithm rejection", npm("run", "server:verify:external-service-api-registration"), [
    "server",
    "external-service",
    "operation",
    "security",
    "regression"
  ]),
  suite("server.external-mcp-passthrough", "External MCP passthrough gateway with FastMCP Docker service", npm("run", "server:verify:external-mcp-passthrough"), [
    "server",
    "external-service",
    "mcp",
    "docker",
    "integration"
  ]),
  suite("server.external-http-adapters", "External HTTP/RPC adapters for OpenAPI, REST, JSON endpoints, and RPC", npm("run", "server:verify:external-http-adapters"), [
    "server",
    "external-service",
    "http",
    "integration",
    "regression"
  ]),
  suite("server.maintenance-agent", "Maintenance agent harness", npm("run", "server:verify:maintenance-agent"), [
    "server",
    "integration",
    "security",
    "maintenance",
    "regression"
  ]),
  suite("server.monitor-alerts", "Monitor alert queue interruption lifecycle", npm("run", "server:verify:monitor-alerts"), [
    "server",
    "monitoring",
    "queue",
    "regression"
  ]),
  suite("server.feature-profiles", "Feature profile checks", npm("run", "server:verify:feature-profiles"), [
    "server",
    "feature-profile",
    "build",
    "packaging",
    "regression"
  ]),
  suite("server.frontend-feature-registry", "Frontend feature registry gate", npm("run", "server:verify:frontend-feature-registry"), [
    "server",
    "web",
    "feature-registry",
    "gate",
    "regression"
  ]),
  suite("server.business-scenarios", "Server business scenario black-box framework", npm("run", "server:verify:business-scenarios"), [
    "server",
    "business",
    "integration",
    "regression"
  ]),
  suite("smoke.server.lifecycle", "Server lifecycle and core API smoke", node("tests/smoke/server-lifecycle-smoke.mjs"), [
    "server",
    "api",
    "smoke"
  ]),
  suite("smoke.memory.source-evidence", "Source evidence memory leak smoke", nodeRuntime("--expose-gc", "tests/smoke/source-evidence-memory-smoke.mjs"), [
    "server",
    "memory",
    "leak",
    "smoke"
  ]),
  suite("smoke.client.cli", "Client CLI smoke", node("tests/smoke/client-cli-smoke.mjs"), [
    "client",
    "cli",
    "smoke"
  ]),
  suite("client.architecture", "Destructive client architecture gate", npm("run", "client:verify:architecture"), [
    "client",
    "architecture",
    "packaging",
    "regression"
  ]),
  suite("client.plan", "Client plan and verifier consistency gate", npm("run", "client:verify:plan"), [
    "client",
    "docs",
    "plan",
    "regression"
  ]),
  suite("client.targets", "Client target adapter contract tests", npm("run", "client:verify:targets"), [
    "client",
    "targets",
    "rust",
    "regression"
  ]),
  suite("client.config-writes", "Client target config write contract tests", npm("run", "client:verify:config-writes"), [
    "client",
    "targets",
    "config",
    "rust",
    "regression"
  ]),
  suite("client.state-store", "Future client state store contract tests", npm("run", "client:verify:state-store"), [
    "client",
    "state",
    "rust",
    "regression"
  ]),
  suite("client.pairing-skill", "Pairing and passive Skill Hub CLI tests", npm("run", "client:verify:pairing-skill-cli"), [
    "client",
    "pairing",
    "skill",
    "rust",
    "regression"
  ]),
  suite("client.mcp-plugins", "Peer MCP plugin lifecycle tests", npm("run", "client:verify:mcp-plugins"), [
    "client",
    "mcp",
    "plugin",
    "rust",
    "regression"
  ]),
  suite("client.thin-forwarding", "Thin model forwarding tests", npm("run", "client:verify:thin-forwarding"), [
    "client",
    "model-forwarding",
    "rust",
    "regression"
  ]),
  suite("client.flutter.analyze", "Flutter static analysis", npm("run", "client:analyze"), [
    "client",
    "flutter",
    "static",
    "regression"
  ]),
  suite("client.flutter.test", "Flutter unit and widget tests", npm("run", "client:test"), [
    "client",
    "flutter",
    "unit",
    "widget",
    "regression"
  ]),
  suite("client.flutter.coverage", "Flutter tests with coverage", npm("run", "client:test:coverage"), [
    "client",
    "flutter",
    "coverage"
  ]),
  suite("client.native.test", "Rust future client CLI tests", npm("run", "client:native:test"), [
    "client",
    "rust",
    "unit",
    "integration",
    "cli",
    "regression"
  ]),
  suite("client.linux.build", "Flutter Linux bundle build", npm("run", "client:build:linux"), [
    "client",
    "linux",
    "build",
    "release"
  ], { platforms: ["linux"] }),
  suite("client.linux.smoke", "Linux bundle command smoke", npm("run", "client:linux:smoke"), [
    "client",
    "linux",
    "smoke",
    "release"
  ], { platforms: ["linux"] }),
  suite("client.linux.gui-smoke", "Linux Xvfb GUI smoke", npm("run", "client:linux:gui-smoke"), [
    "client",
    "linux",
    "gui",
    "smoke",
    "release"
  ], { platforms: ["linux"] }),
  suite("client.ubuntu.verify", "Ubuntu desktop client verification", npm("run", "client:ubuntu:verify"), [
    "client",
    "ubuntu",
    "gui",
    "docker",
    "release"
  ]),
  suite("repo.hygiene.post", "Repository hygiene after generated output", npm("run", "repo:hygiene"), [
    "repo",
    "hygiene",
    "regression",
    "security"
  ])
];

const suiteById = new Map(suites.map((entry) => [entry.id, entry]));

const profileSuites = {
  fast: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "server.external-service-api-registration",
    "server.frontend-feature-registry",
    "client.architecture",
    "client.plan",
    "client.state-store",
    "client.targets",
    "client.config-writes",
    "client.pairing-skill",
    "client.mcp-plugins",
    "client.thin-forwarding",
    "client.flutter.analyze",
    "client.flutter.test",
    "client.native.test"
  ],
  standard: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "security.npm-audit",
    "server.web.build",
    "server.headless",
    "server.mcp-http",
    "server.continuity",
    "server.checkpoints",
    "server.rebuild",
    "server.ops",
    "server.knowledge",
    "server.operation-policy",
    "server.dispatcher-unified",
    "server.trace-context",
    "server.state-mutations",
    "server.console-auth",
    "server.runtime-logging",
    "server.context-compaction",
    "server.client-runtime-allocator",
    "server.agent-gateway-compaction",
    "server.maintenance-agent-compaction",
    "server.entity-config-layout",
    "server.singleton-boundaries",
    "server.source-evidence",
    "server.multi-source-connectors",
    "server.external-service-api-registration",
    "server.maintenance-agent",
    "server.monitor-alerts",
    "server.feature-profiles",
    "server.frontend-feature-registry",
    "server.business-scenarios",
    "client.architecture",
    "client.plan",
    "client.state-store",
    "client.targets",
    "client.config-writes",
    "client.pairing-skill",
    "client.mcp-plugins",
    "client.thin-forwarding",
    "client.flutter.analyze",
    "client.flutter.test",
    "client.native.test",
    "repo.hygiene.post"
  ],
  coverage: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "client.architecture",
    "client.plan",
    "client.state-store",
    "client.targets",
    "client.config-writes",
    "client.pairing-skill",
    "client.mcp-plugins",
    "client.thin-forwarding",
    "client.flutter.analyze",
    "client.flutter.coverage",
    "client.native.test"
  ],
  security: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "security.npm-audit",
    "server.headless",
    "server.mcp-http",
    "server.operation-policy",
    "server.dispatcher-unified",
    "server.trace-context",
    "server.state-mutations",
    "server.console-auth",
    "server.runtime-logging",
    "server.context-compaction",
    "server.client-runtime-allocator",
    "server.agent-gateway-compaction",
    "server.maintenance-agent-compaction",
    "server.entity-config-layout",
    "server.singleton-boundaries",
    "server.source-evidence",
    "server.multi-source-connectors",
    "server.external-service-api-registration",
    "server.maintenance-agent",
    "server.feature-profiles",
    "server.frontend-feature-registry",
    "client.architecture",
    "client.plan",
    "client.native.test",
    "repo.hygiene.post"
  ],
  server: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "server.web.build",
    "server.headless",
    "server.mcp-http",
    "server.continuity",
    "server.checkpoints",
    "server.rebuild",
    "server.ops",
    "server.knowledge",
    "server.operation-policy",
    "server.console-auth",
    "server.runtime-logging",
    "server.context-compaction",
    "server.client-runtime-allocator",
    "server.agent-gateway-compaction",
    "server.maintenance-agent-compaction",
    "server.entity-config-layout",
    "server.singleton-boundaries",
    "server.source-evidence",
    "server.multi-source-connectors",
    "server.external-service-api-registration",
    "server.maintenance-agent",
    "server.monitor-alerts",
    "server.feature-profiles",
    "server.frontend-feature-registry",
    "server.business-scenarios",
    "server.dispatcher-unified",
    "server.trace-context",
    "server.state-mutations",
    "repo.hygiene.post"
  ],
  smoke: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "server.source-evidence",
    "server.multi-source-connectors",
    "server.external-service-api-registration",
    "server.console-auth",
    "server.dispatcher-unified",
    "server.trace-context",
    "server.state-mutations",
    "server.runtime-logging",
    "server.frontend-feature-registry",
    "server.entity-config-layout",
    "server.singleton-boundaries",
    "client.architecture",
    "client.plan",
    "smoke.server.lifecycle",
    "smoke.memory.source-evidence",
    "smoke.client.cli",
    "repo.hygiene.post"
  ],
  prebuild: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "security.npm-audit",
    "server.web.build",
    "server.headless",
    "server.mcp-http",
    "server.continuity",
    "server.checkpoints",
    "server.rebuild",
    "server.ops",
    "server.knowledge",
    "server.operation-policy",
    "server.dispatcher-unified",
    "server.trace-context",
    "server.state-mutations",
    "server.console-auth",
    "server.runtime-logging",
    "server.context-compaction",
    "server.client-runtime-allocator",
    "server.agent-gateway-compaction",
    "server.maintenance-agent-compaction",
    "server.entity-config-layout",
    "server.singleton-boundaries",
    "server.source-evidence",
    "server.multi-source-connectors",
    "server.external-service-api-registration",
    "server.maintenance-agent",
    "server.feature-profiles",
    "server.frontend-feature-registry",
    "server.business-scenarios",
    "client.architecture",
    "client.plan",
    "client.state-store",
    "client.targets",
    "client.config-writes",
    "client.pairing-skill",
    "client.mcp-plugins",
    "client.thin-forwarding",
    "client.flutter.analyze",
    "client.flutter.test",
    "client.native.test",
    "smoke.server.lifecycle",
    "smoke.memory.source-evidence",
    "smoke.client.cli",
    "repo.hygiene.post"
  ],
  client: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "client.architecture",
    "client.plan",
    "client.state-store",
    "client.targets",
    "client.config-writes",
    "client.pairing-skill",
    "client.mcp-plugins",
    "client.thin-forwarding",
    "client.flutter.analyze",
    "client.flutter.test",
    "client.native.test",
    "repo.hygiene.post"
  ],
  linux: [
    "client.linux.build",
    "client.linux.smoke",
    "client.linux.gui-smoke"
  ],
  ubuntu: [
    "client.ubuntu.verify"
  ],
  release: [
    "repo.hygiene.pre",
    "security.secret-hygiene",
    "security.npm-audit",
    "server.web.build",
    "server.headless",
    "server.mcp-http",
    "server.continuity",
    "server.checkpoints",
    "server.rebuild",
    "server.ops",
    "server.knowledge",
    "server.operation-policy",
    "server.console-auth",
    "server.runtime-logging",
    "server.client-runtime-allocator",
    "server.entity-config-layout",
    "server.singleton-boundaries",
    "server.source-evidence",
    "server.multi-source-connectors",
    "server.external-service-api-registration",
    "server.maintenance-agent",
    "server.feature-profiles",
    "server.frontend-feature-registry",
    "server.frontend-feature-registry",
    "server.business-scenarios",
    "server.dispatcher-unified",
    "server.trace-context",
    "server.state-mutations",
    "smoke.server.lifecycle",
    "smoke.memory.source-evidence",
    "smoke.client.cli",
    "client.architecture",
    "client.plan",
    "client.state-store",
    "client.targets",
    "client.config-writes",
    "client.pairing-skill",
    "client.mcp-plugins",
    "client.thin-forwarding",
    "client.flutter.analyze",
    "client.flutter.test",
    "client.native.test",
    "client.linux.build",
    "client.linux.smoke",
    "client.linux.gui-smoke",
    "client.ubuntu.verify",
    "repo.hygiene.post"
  ]
};

function npm(...args) {
  return { command: npmCommand, args };
}

function node(scriptPath, ...args) {
  return { command: process.execPath, args: [scriptPath, ...args] };
}

function nodeRuntime(...args) {
  return { command: process.execPath, args };
}

function suite(id, label, commandSpec, tags, options = {}) {
  return {
    id,
    label,
    command: commandSpec.command,
    args: commandSpec.args,
    tags,
    platforms: options.platforms || null
  };
}

function parseArgs(argv) {
  const options = {
    profile: "fast",
    suites: [],
    tags: [],
    list: false,
    dryRun: false,
    continueOnFailure: false,
    strictPlatform: false,
    report: null,
    changedBase: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile" || arg === "-p") {
      options.profile = takeValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
      continue;
    }
    if (arg === "--suite" || arg === "-s") {
      options.suites.push(...splitCsv(takeValue(argv, ++index, arg)));
      continue;
    }
    if (arg.startsWith("--suite=")) {
      options.suites.push(...splitCsv(arg.slice("--suite=".length)));
      continue;
    }
    if (arg === "--tag" || arg === "-t") {
      options.tags.push(...splitCsv(takeValue(argv, ++index, arg)));
      continue;
    }
    if (arg.startsWith("--tag=")) {
      options.tags.push(...splitCsv(arg.slice("--tag=".length)));
      continue;
    }
    if (arg === "--changed-base") {
      options.changedBase = takeValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--changed-base=")) {
      options.changedBase = arg.slice("--changed-base=".length);
      continue;
    }
    if (arg === "--report") {
      options.report = takeValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--report=")) {
      options.report = arg.slice("--report=".length);
      continue;
    }
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--continue-on-failure") {
      options.continueOnFailure = true;
      continue;
    }
    if (arg === "--strict-platform") {
      options.strictPlatform = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function splitCsv(value) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function printHelp() {
  console.log(`Pact unified test runner

Usage:
  node tests/run.mjs [--profile fast|standard|coverage|security|server|smoke|prebuild|client|linux|ubuntu|release|changed]
  node tests/run.mjs --suite client.native.test --suite server.headless
  node tests/run.mjs --tag security --continue-on-failure

Options:
  --list                  Print suites and profiles.
  --dry-run               Print selected suites without executing them.
  --continue-on-failure   Run remaining suites after a failure.
  --strict-platform       Treat platform-incompatible suites as failures.
  --report <path>         Write report JSON to an explicit path.
  --changed-base <ref>    Base ref for the changed profile. Defaults to HEAD.
`);
}

function listSuites() {
  console.log("Profiles:");
  for (const [profile, ids] of Object.entries(profileSuites)) {
    console.log(`- ${profile}: ${ids.join(", ")}`);
  }
  console.log("- changed: derived from git changed files");
  console.log("");
  console.log("Suites:");
  for (const entry of suites) {
    const platforms = entry.platforms ? ` platforms=${entry.platforms.join(",")}` : "";
    console.log(`- ${entry.id}: ${entry.label} [${entry.tags.join(", ")}]${platforms}`);
  }
}

function resolveSuiteIds(options) {
  const explicitIds = new Set(options.suites);
  for (const tag of options.tags) {
    for (const entry of suites) {
      if (entry.tags.includes(tag)) {
        explicitIds.add(entry.id);
      }
    }
  }

  if (explicitIds.size > 0) {
    return uniqueKnownSuites([...explicitIds]);
  }

  if (options.profile === "changed") {
    return changedSuiteIds(options.changedBase || "HEAD");
  }

  const ids = profileSuites[options.profile];
  if (!ids) {
    throw new Error(`Unknown profile: ${options.profile}`);
  }
  return uniqueKnownSuites(ids);
}

function uniqueKnownSuites(ids) {
  const selected = [];
  const seen = new Set();
  for (const id of ids) {
    if (!suiteById.has(id)) {
      throw new Error(`Unknown suite: ${id}`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      selected.push(id);
    }
  }
  return selected;
}

function changedSuiteIds(baseRef) {
  const changedFiles = new Set();
  for (const file of gitLines(["diff", "--name-only", "--diff-filter=ACMRTUXB", baseRef])) {
    changedFiles.add(file);
  }
  for (const file of gitLines(["ls-files", "--others", "--exclude-standard"])) {
    changedFiles.add(file);
  }

  const selected = new Set(["repo.hygiene.pre", "security.secret-hygiene"]);
  for (const file of changedFiles) {
    if (file === "package.json" || file === "package-lock.json" || file.startsWith("tests/")) {
      selected.add("security.npm-audit");
      selected.add("client.native.test");
      selected.add("client.flutter.test");
      selected.add("server.headless");
      selected.add("server.mcp-http");
      selected.add("smoke.server.lifecycle");
      selected.add("smoke.memory.source-evidence");
      selected.add("smoke.client.cli");
    }
    if (file.startsWith("server/")) {
      selected.add("server.headless");
      selected.add("server.mcp-http");
      selected.add("server.continuity");
      selected.add("server.checkpoints");
      selected.add("server.rebuild");
      selected.add("server.ops");
      selected.add("server.knowledge");
      selected.add("server.source-evidence");
      selected.add("server.multi-source-connectors");
      selected.add("server.external-service-api-registration");
      selected.add("server.maintenance-agent");
      selected.add("server.feature-profiles");
      selected.add("server.frontend-feature-registry");
      selected.add("smoke.server.lifecycle");
    }
    if (file.startsWith("server-web/") || file === "vite.config.ts") {
      selected.add("server.web.build");
      selected.add("server.frontend-feature-registry");
      selected.add("smoke.server.lifecycle");
    }
    if (file.startsWith("client-cli/")) {
      selected.add("client.native.test");
      selected.add("smoke.client.cli");
    }
    if (file.startsWith("client-gui/")) {
      selected.add("client.flutter.analyze");
      selected.add("client.flutter.test");
      if (file.startsWith("client-gui/linux/") || file.startsWith("client-gui/scripts/")) {
        selected.add("client.linux.build");
        selected.add("client.linux.smoke");
      }
    }
    if (file.startsWith("docs/") || file === "README.md") {
      selected.add("repo.hygiene.post");
    }
    if (file.startsWith("external-services/")) {
      selected.add("server.external-service-api-registration");
    }
  }

  selected.add("repo.hygiene.post");
  return uniqueKnownSuites([...selected]);
}

function gitLines(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function commandLine(entry) {
  return [entry.command, ...entry.args].join(" ");
}

function isPlatformCompatible(entry) {
  return !entry.platforms || entry.platforms.includes(process.platform);
}

function runSuite(entry) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn(entry.command, entry.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit"
    });

    child.on("close", (exitCode, signal) => {
      const finishedAt = new Date();
      resolve({
        id: entry.id,
        label: entry.label,
        command: commandLine(entry),
        status: exitCode === 0 ? "passed" : "failed",
        exitCode,
        signal,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime()
      });
    });

    child.on("error", (error) => {
      const finishedAt = new Date();
      resolve({
        id: entry.id,
        label: entry.label,
        command: commandLine(entry),
        status: "failed",
        error: error.message,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime()
      });
    });
  });
}

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    listSuites();
    return;
  }

  const selectedIds = resolveSuiteIds(options);
  const startedAt = new Date();
  const results = [];

  console.log(`Pact test runner: profile=${options.profile} suites=${selectedIds.length}`);
  console.log(`Report directory: ${defaultReportDir}`);

  for (const id of selectedIds) {
    const entry = suiteById.get(id);
    const compatible = isPlatformCompatible(entry);
    if (!compatible) {
      const status = options.strictPlatform ? "failed" : "skipped";
      const result = {
        id: entry.id,
        label: entry.label,
        command: commandLine(entry),
        status,
        reason: `Suite supports ${entry.platforms.join(", ")} but current platform is ${process.platform}`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0
      };
      results.push(result);
      console.log(`${status.toUpperCase()} ${entry.id} - ${result.reason}`);
      if (status === "failed" && !options.continueOnFailure) {
        break;
      }
      continue;
    }

    if (options.dryRun) {
      const result = {
        id: entry.id,
        label: entry.label,
        command: commandLine(entry),
        status: "dry-run",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0
      };
      results.push(result);
      console.log(`DRY-RUN ${entry.id}: ${result.command}`);
      continue;
    }

    console.log(`\nRUN ${entry.id}: ${entry.label}`);
    console.log(commandLine(entry));
    const result = await runSuite(entry);
    results.push(result);
    console.log(`${result.status.toUpperCase()} ${entry.id} (${result.durationMs}ms)`);
    if (result.status === "failed" && !options.continueOnFailure) {
      break;
    }
  }

  const finishedAt = new Date();
  const summary = summarize(results);
  const report = {
    schemaVersion: 1,
    runner: "pact-unified-test-runner",
    profile: options.profile,
    selectedSuites: selectedIds,
    options: {
      tags: options.tags,
      explicitSuites: options.suites,
      dryRun: options.dryRun,
      continueOnFailure: options.continueOnFailure,
      strictPlatform: options.strictPlatform,
      changedBase: options.changedBase
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpus: os.cpus().length
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    summary,
    suites: results
  };

  const timestamp = startedAt.toISOString().replace(/[:.]/gu, "-");
  const reportPath = options.report
    ? path.resolve(repoRoot, options.report)
    : path.join(defaultReportDir, `pact-test-report-${timestamp}.json`);
  await writeJsonAtomic(reportPath, report);
  await writeJsonAtomic(path.join(defaultReportDir, "latest.json"), report);

  console.log("");
  console.log(`Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.dryRun} dry-run`);
  console.log(`Report: ${reportPath}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

function summarize(results) {
  const summary = {
    passed: 0,
    failed: 0,
    skipped: 0,
    dryRun: 0
  };
  for (const result of results) {
    if (result.status === "passed") {
      summary.passed += 1;
    } else if (result.status === "failed") {
      summary.failed += 1;
    } else if (result.status === "skipped") {
      summary.skipped += 1;
    } else if (result.status === "dry-run") {
      summary.dryRun += 1;
    }
  }
  return summary;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
