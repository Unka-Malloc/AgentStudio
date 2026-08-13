#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const skippedDirs = new Set([
  ".git",
  ".codex-research",
  ".gemini",
  ".kilo",
  ".vscode",
  "build",
  "node_modules",
  "test-results"
]);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skippedDirs.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
      continue;
    }
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function relative(filePath) {
  return path.relative(root, filePath);
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

function addFinding(findings, file, reason, detail = "") {
  findings.push({
    file,
    reason,
    detail
  });
}

function stripYamlComments(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableJson(child)])
    );
  }
  return value;
}

function equalStableJson(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function packageMinorLine(version) {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(version);
  if (!match) throw new Error(`Expected plain semver package version, got ${version}`);
  return `${match[1]}.${match[2]}.x`;
}

async function readIfExists(relativePath) {
  try {
    return await readText(relativePath);
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function verifyPackageVersionDocs(findings) {
  const packageJson = JSON.parse(await readText("package.json"));
  const currentMinorLine = packageMinorLine(packageJson.version);
  const security = await readIfExists("SECURITY.md");
  const migration = await readIfExists("docs/MIGRATION.md");

  if (!new RegExp(`\\|\\s*${escapeRegExp(currentMinorLine)}\\s*\\|\\s*Yes\\s*\\|`).test(security)) {
    addFinding(
      findings,
      "SECURITY.md",
      "missing_current_supported_version",
      `Security policy must list the current package minor line ${currentMinorLine} as supported.`
    );
  }

  if (!new RegExp(`\\|\\s*${escapeRegExp(currentMinorLine)}[^\\n]*\\^22\\.0\\.0[^\\n]*\\^24\\.0\\.0`).test(migration)) {
    addFinding(
      findings,
      "docs/MIGRATION.md",
      "missing_current_node_compatibility",
      `Migration guide must list the current package minor line ${currentMinorLine} in Node.js compatibility.`
    );
  }

  if (/###\s+Current:\s+v\d/i.test(migration)) {
    addFinding(
      findings,
      "docs/MIGRATION.md",
      "ambiguous_current_version_heading",
      "Migration guide must distinguish package version from protocol/data format in current-version headings."
    );
  }
}

function verifyNoProcessStateDocs(files, findings) {
  const processStateName = /(^|[-_.\s])(implementation[-_.\s]*(plan|guide)|gap|gaps)([-_.\s]|$)/i;
  const versionNamedDoc = /(^|[-_.\s])v?\d+[.-]\d+([.-]\d+)?($|[-_.\s])/i;
  for (const file of files) {
    const rel = relative(file);
    const ext = path.extname(rel).toLowerCase();
    if (![".md", ".mdx", ".txt"].includes(ext)) continue;
    const base = path.basename(rel, ext);
    if (processStateName.test(base)) {
      addFinding(findings, rel, "process_state_document", "Implementation Plan, Implementation Guide, Gap, and similar files block release.");
    }
    if (rel.startsWith("docs/") && versionNamedDoc.test(base)) {
      addFinding(findings, rel, "version_named_document", "Maintained docs must describe current state instead of carrying a version-named file.");
    }
  }
}

async function verifyNoVersionOrganizedStructure(files, findings) {
  const versionSegment = /(^|[-_.])v\d+(?:[._-]?\d+)*(?=$|[-_.])/i;
  const contentExtensions = new Set([".js", ".mjs", ".ts", ".d.ts", ".json", ".md", ".yml", ".yaml"]);
  const versionOrganizedContent = [
    /\bjson-v\d+\b/i,
    /\bindexed-v\d+\b/i,
    /\bcar-like-v\d+\b/i,
    /\bpactium-cdc-v\d+\b/i,
    /\b(?:proofType|bundleType)\s*:\s*["'][^"']*\.v\d+["']/i,
    /\bpactium\.proof-bundle\.v\d+\b/i,
    /\bversion\s*:\s*["']v\d+["']/i
  ];
  const prohibitedEntrypoints = [/^src\/v\d+\.js$/i];
  for (const file of files) {
    const rel = relative(file);
    const base = path.basename(rel);
    if (prohibitedEntrypoints.some((pattern) => pattern.test(rel))) {
      addFinding(findings, rel, "version_named_entrypoint", "Old version-named entrypoints must not remain as source organization.");
    }
    if (
      ["src/", "scripts/", "tests/", "docs/"].some((prefix) => rel.startsWith(prefix)) &&
      versionSegment.test(base)
    ) {
      addFinding(findings, rel, "version_organized_file", "Code, tests, scripts, and docs must be organized by function, not version number.");
    }
    if (
      ["src/", "scripts/", "tests/", "docs/"].some((prefix) => rel.startsWith(prefix)) &&
      contentExtensions.has(path.extname(rel).toLowerCase())
    ) {
      const text = await fs.readFile(file, "utf8").catch(() => "");
      for (const pattern of versionOrganizedContent) {
        if (pattern.test(text)) {
          addFinding(
            findings,
            rel,
            "version_organized_content",
            "Code, tests, scripts, and docs must not organize proof, bundle, or implementation behavior by version-number labels."
          );
          break;
        }
      }
    }
  }

  const packageJson = JSON.parse(await readText("package.json"));
  for (const name of Object.keys(packageJson.scripts || {})) {
    if (versionSegment.test(name)) {
      addFinding(findings, "package.json", "version_organized_script", `Script ${name} is organized by version number.`);
    }
  }
}

async function verifyToolingSurface(files, findings) {
  const packageJson = JSON.parse(await readText("package.json"));
  const expectedScripts = {
    start: "pactium serve",
    "release:prepare": "node scripts/prepare-release.mjs",
    "docs:sync-version": "node scripts/update-published-doc-versions.mjs --write",
    test: "node --test tests/pactium/*.test.mjs",
    "test:coverage": "node scripts/run-source-coverage.mjs",
    verify: "npm run verify:release",
    "verify:core": "npm run test:coverage",
    "verify:docs:versions": "node scripts/update-published-doc-versions.mjs --check",
    "verify:hygiene": "node scripts/verify-pactium-hygiene.mjs",
    "verify:protocol:gates": "node scripts/verify-protocol-gates.mjs",
    "verify:package:contents": "node scripts/verify-package-contents.mjs",
    "verify:release:readiness": "node scripts/verify-release-readiness.mjs",
    "verify:release": "npm run verify:hygiene && npm run verify:core && npm run verify:protocol:gates && npm run verify:release:readiness && npm run verify:docs:versions && npm run verify:package:contents && npm run pack:dry-run && npm run publish:dry-run",
    "pack:dry-run": "npm pack --dry-run",
    "publish:dry-run": "node scripts/verify-publish-dry-run.mjs"
  };
  const expectedBin = {
    pactium: "bin/pactium.mjs"
  };
  const expectedPublishConfig = {
    access: "public",
    provenance: true,
    registry: "https://registry.npmjs.org/"
  };
  const expectedExports = {
    ".": {
      types: "./src/index.d.ts",
      import: "./src/index.js",
      default: "./src/index.js"
    },
    "./http": {
      types: "./src/http.d.ts",
      import: "./src/http.js",
      default: "./src/http.js"
    },
    "./package.json": "./package.json"
  };
  const expectedFiles = [
    "src/",
    "bin/",
    "examples/",
    "CHANGELOG.md",
    "PRODUCT.md",
    "CONTEXT.md",
    "docs/logo.svg",
    "docs/README.md",
    "docs/API.md",
    "docs/FAQ.md",
    "docs/MIGRATION.md",
    "docs/architecture/",
    "docs/protocols/",
    "docs/TERM.md",
    "README.md",
    "README.zh-CN.md",
    "SECURITY.md",
    "LICENSE"
  ];

  for (const [label, actual, expected] of [
    ["scripts", packageJson.scripts, expectedScripts],
    ["bin", packageJson.bin, expectedBin],
    ["publishConfig", packageJson.publishConfig, expectedPublishConfig],
    ["exports", packageJson.exports, expectedExports],
    ["files", packageJson.files, expectedFiles]
  ]) {
    if (!equalStableJson(actual, expected)) {
      addFinding(
        findings,
        "package.json",
        "tooling_surface_drift",
        `package.json ${label} must match the current Pactium tooling surface.`
      );
    }
  }

  const rels = files.map(relative).sort();
  if (!rels.includes("AGENT.md")) {
    addFinding(
      findings,
      "AGENT.md",
      "missing_agent_entry",
      "Pactium requires root AGENT.md as the single in-repository entry for automated coding agents."
    );
  }
  for (const requiredAuthority of ["PRODUCT.md", "CONTEXT.md"]) {
    if (!rels.includes(requiredAuthority)) {
      addFinding(
        findings,
        requiredAuthority,
        "missing_product_authority",
        `${requiredAuthority} is required as a repository boundary authority.`
      );
    }
  }
  const expectedToolFiles = [
    "bin/pactium.mjs",
    "scripts/prepare-release.mjs",
    "scripts/run-source-coverage.mjs",
    "scripts/update-published-doc-versions.mjs",
    "scripts/verify-package-contents.mjs",
    "scripts/verify-pactium-hygiene.mjs",
    "scripts/verify-protocol-gates.mjs",
    "scripts/verify-publish-dry-run.mjs",
    "scripts/verify-release-readiness.mjs"
  ];
  const actualToolFiles = rels.filter((rel) => rel.startsWith("bin/") || rel.startsWith("scripts/"));
  if (!equalStableJson(actualToolFiles, expectedToolFiles)) {
    addFinding(
      findings,
      "scripts/",
      "tooling_file_inventory_drift",
      `Expected only ${expectedToolFiles.join(", ")}.`
    );
  }

  const prohibitedProjectTooling = [
    ".gemini",
    ".github/skills",
    ".impeccable",
    ".kilo",
    "AGENTS.md",
    "skills",
    "tools",
    "server/config/entity-config/tools",
    "server/config/entity-config/skills",
    "server/platform/specialized/capabilities/tools",
    "server/platform/specialized/capabilities/skills"
  ];
  for (const rel of prohibitedProjectTooling) {
    if (await pathExists(path.join(root, rel))) {
      addFinding(
        findings,
        rel,
        "unapproved_project_tool_or_skill",
        "Pactium uses root AGENT.md as its single agent entry; keep extra agent entries, project-local agent skills, and unrelated tool registries outside this repository."
      );
    }
  }

  const legacyToolingName = new RegExp([
    "\\bv" + "02\\b",
    "v" + "02-",
    "verify-v" + "02",
    "verify:v0\\.2",
    "verify-v0\\.2"
  ].join("|"), "i");
  const toolingTextFiles = [
    ".gitignore",
    "package.json",
    ".github/workflows/ci.yml",
    ".github/workflows/publish.yml",
    "bin/pactium.mjs",
    "scripts/prepare-release.mjs",
    "scripts/run-source-coverage.mjs",
    "scripts/update-published-doc-versions.mjs",
    "scripts/verify-pactium-hygiene.mjs",
    "scripts/verify-protocol-gates.mjs",
    "scripts/verify-package-contents.mjs",
    "scripts/verify-publish-dry-run.mjs",
    "scripts/verify-release-readiness.mjs",
    "docs/TOOLING.md",
    "docs/QUALITY-GATES.md",
    "docs/RELEASE.md"
  ];
  for (const rel of toolingTextFiles) {
    const text = await readIfExists(rel);
    if (legacyToolingName.test(text)) {
      addFinding(
        findings,
        rel,
        "legacy_tooling_name",
        "Tooling, scripts, fixtures, and release docs must use current function-based names instead of old version-named labels."
      );
    }
  }
}

async function verifyDesignImplementationAnchors(findings) {
  const sourceText = await Promise.all([
    "src/index.js",
    "src/protocol/constants.js",
    "src/protocol/hashing.js",
    "src/canonical/value.js",
    "src/storage/local-json-storage-port.js",
    "src/storage/sqlite-capability.js",
    "src/storage/sqlite-storage-port.js",
    "src/storage/storage-port.js",
    "src/ledger/transparency-log.js",
    "src/index-engine/snapshot-merkle-index.js",
    "src/core/pactium-core.js",
    "src/proof/envelope.js",
    "src/proof/bundle.js",
    "src/repair/planner.js",
    "src/maintenance/task-engine.js",
    "src/quality/profile-runner.js",
    "src/http.js",
    "bin/pactium.mjs",
    "package.json"
  ].map(readText));
  const code = sourceText.join("\n");
  const anchors = [
    {
      design: "Canonical Value",
      code: ["canonicalEncode", "canonicalDecode", "protocolHash"],
      adr: "docs/adr/0016-use-pactium-canonical-json-values.md"
    },
    {
      design: "Storage Port",
      code: ["createStoragePort", "createJsonStoragePort", "detectSqliteCapabilities", "putBlock", "getBlock"],
      adr: "docs/adr/0014-storage-port-with-local-backend.md"
    },
    {
      design: "Ledger Transparency Log",
      code: ["createLedgerTransparencyLog", "createLedgerInclusionProof", "verifyLedgerConsistencyProof"],
      adr: "docs/adr/0006-use-transparency-log-for-ledger.md"
    },
    {
      design: "Verifiable Index Engine",
      code: ["createVerifiableIndexEngine", "verifyProof", "readSnapshot"],
      adr: "docs/adr/0004-share-the-verifiable-index-engine.md"
    },
    {
      design: "Operation Lifecycle",
      code: ["beginOperationIntent", "appendOperationOutcome", "lookupOpenIntent", "lookupOutcome"],
      adr: "docs/adr/0039-expose-operation-lifecycle-primitives.md"
    },
    {
      design: "Workspace Projection",
      code: ["getWorkspaceProjection", "proveWorkspaceMembership"],
      adr: "docs/adr/0018-use-global-ledger-with-workspace-projections.md"
    },
    {
      design: "Proof Envelope and Proof Bundle",
      code: ["verifyProofEnvelope", "verifyProofBundle", "exportProofBundle"],
      adr: "docs/adr/0025-return-proof-refs-and-export-proof-bundles.md"
    },
    {
      design: "Release Readiness Gate",
      code: ["verify:release:readiness", "verify-release-readiness.mjs"],
      adr: "docs/adr/0054-adopt-quality-gates.md"
    }
  ];

  for (const anchor of anchors) {
    for (const token of anchor.code) {
      if (!code.includes(token)) {
        addFinding(findings, anchor.adr, "documented_design_without_implementation", `${anchor.design} is missing implementation anchor ${token}.`);
      }
    }
    if (!(await pathExists(path.join(root, anchor.adr)))) {
      addFinding(findings, anchor.adr, "documented_design_without_adr", `${anchor.design} is missing ADR coverage.`);
    }
  }
}

async function verifyRepositoryBoundaryDocs(findings) {
  const contracts = {
    "PRODUCT.md": [
      /host-neutral proof-first protocol substrate/i,
      /Meshrix is an independent downstream framework/i,
      /does not retain those business values by default/i
    ],
    "CONTEXT.md": [
      /\*\*Input Digest\*\*/,
      /\*\*Result Digest\*\*/,
      /\*\*Explicit Proof Copy\*\*/,
      /not tenant, authorization, or storage isolation/i
    ],
    "README.md": [
      /Meshrix is an independent downstream framework/i,
      /does not retain those business values by default/i,
      /does not provide tenant or authorization isolation/i
    ],
    "README.zh-CN.md": [
      /Meshrix 是独立的下游框架/,
      /默认不保存这些业务值/,
      /不提供租户或授权隔离/
    ],
    "SECURITY.md": [
      /inputs and results are retained as hashes by default/i,
      /State Values and Proof Extension values are explicit host-authorized persistence surfaces/i
    ],
    "docs/API.md": [
      /package surface is host-neutral/i,
      /their original values are not copied into facts or Proof Bundles/i
    ],
    "docs/architecture/ARCHITECTURE.md": [
      /host-neutral proof-first protocol substrate/i,
      /Workspace Projection is logical membership and ordering, not an access-control boundary/i
    ],
    "docs/protocols/PROTOCOLS.md": [
      /protocol is host-neutral/i,
      /Pactium never creates those content copies implicitly/i
    ],
    "docs/protocols/PROFILE.md": [
      /Intent and Outcome facts retain input\/result digests, not original values/i,
      /State mutation values and Proof Extension values are persisted only when supplied by the caller/i
    ]
  };
  for (const [file, patterns] of Object.entries(contracts)) {
    const text = await readIfExists(file);
    for (const pattern of patterns) {
      if (!pattern.test(text)) {
        addFinding(
          findings,
          file,
          "repository_boundary_drift",
          "Maintained product projections must preserve the canonical host, Meshrix, content-retention, and workspace-isolation boundaries."
        );
        break;
      }
    }
  }
}

async function verifyNodeLtsMatrix(findings) {
  const packageJson = JSON.parse(await readText("package.json"));
  const workflow = await readText(".github/workflows/ci.yml");
  const publishWorkflow = await readText(".github/workflows/publish.yml");
  const releaseRules = await readText("docs/RELEASE.md");
  const supported = ["22", "24"];
  for (const major of supported) {
    if (!String(packageJson.engines?.node || "").includes(`^${major}.0.0`)) {
      addFinding(findings, "package.json", "missing_lts_engine", `Node.js ${major} is missing from engines.node.`);
    }
    if (!new RegExp(`\\b${major}\\b`).test(workflow)) {
      addFinding(findings, ".github/workflows/ci.yml", "missing_lts_ci_gate", `Node.js ${major} is missing from the CI release matrix.`);
    }
    if (!new RegExp(`\\b${major}\\b`).test(publishWorkflow)) {
      addFinding(findings, ".github/workflows/publish.yml", "missing_lts_publish_gate", `Node.js ${major} is missing from the publish workflow verification matrix.`);
    }
    if (!new RegExp(`\\b${major}\\b`).test(releaseRules)) {
      addFinding(findings, "docs/RELEASE.md", "missing_lts_release_doc", `Node.js ${major} is missing from release rules.`);
    }
  }
  for (const branch of ["stable", "nightly"]) {
    if (!new RegExp(`\\b${branch}\\b`).test(workflow)) {
      addFinding(
        findings,
        ".github/workflows/ci.yml",
        "missing_release_branch_ci_gate",
        `Release branch ${branch} is missing from CI push triggers.`
      );
    }
  }
}

async function verifyPublishWorkflow(findings) {
  const workflow = stripYamlComments(await readText(".github/workflows/publish.yml"));
  const requiredPatterns = [
    [/release-source:/, "missing_stable_publish_source_job"],
    [/Manual publish dispatch must use the stable branch/, "missing_stable_manual_publish_gate"],
    [/GITHUB_REF_NAME[^]*stable/, "missing_stable_ref_publish_gate"],
    [/git merge-base --is-ancestor "\$\{RELEASE_SHA\}" origin\/stable/, "missing_stable_tag_ancestor_gate"],
    [/publish:\s*[^]*needs:\s*\[release-source,\s*package-status,\s*verify\]/, "missing_publish_verify_dependency"],
    [/id-token:\s*write/, "missing_oidc_permission"],
    [/npm install -g npm@latest/, "missing_current_npm_cli"],
    [/npm run verify:release/, "missing_release_gate_before_publish"],
    [/NPM_CONFIG_PROVENANCE:\s*["']?true["']?/, "missing_provenance_config"],
    [/npm publish --access public/, "missing_public_publish_command"]
  ];
  for (const [pattern, reason] of requiredPatterns) {
    if (!pattern.test(workflow)) {
      addFinding(findings, ".github/workflows/publish.yml", reason, "Publish workflow must use npm Trusted Publishing with provenance after the release gate passes.");
    }
  }
  if (/NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/i.test(workflow)) {
    addFinding(
      findings,
      ".github/workflows/publish.yml",
      "long_lived_publish_token",
      "Publish workflow must use GitHub OIDC trusted publishing, not a long-lived npm token."
    );
  }
}

async function verifyDocumentImplementationDrift(findings) {
  const packageJson = JSON.parse(await readText("package.json"));
  const sourceText = await Promise.all([
    "src/protocol/constants.js",
    "src/protocol/hashing.js",
    "src/canonical/value.js",
    "src/storage/local-json-storage-port.js",
    "src/storage/sqlite-capability.js",
    "src/storage/sqlite-storage-port.js",
    "src/storage/storage-port.js",
    "src/ledger/transparency-log.js",
    "src/index-engine/snapshot-merkle-index.js",
    "src/core/pactium-core.js",
    "src/proof/envelope.js",
    "src/proof/bundle.js",
    "src/repair/planner.js",
    "src/maintenance/task-engine.js",
    "src/quality/profile-runner.js",
    "package.json"
  ].map(readText));
  const code = sourceText.join("\n");
  const packageText = JSON.stringify(packageJson);

  const storageAdr = await readIfExists("docs/adr/0014-storage-port-with-local-backend.md");
  const hasSqliteImplementation = /sqlite|better-sqlite|Database\(/i.test(`${code}\n${packageText}`);
  if (!hasSqliteImplementation && /filesystem\/SQLite/i.test(storageAdr)) {
    addFinding(
      findings,
      "docs/adr/0014-storage-port-with-local-backend.md",
      "sqlite_storage_claim_without_implementation",
      "Docs must not claim a SQLite storage backend unless SQLite code or dependencies exist."
    );
  }

  const profile = await readIfExists("docs/protocols/PROFILE.md");
  const workspaceQueueImplemented = /workspace.*queue|queue.*workspace|WorkspaceLaneQueue|workspaceLanes/i.test(code);
  if (!workspaceQueueImplemented && /Per-workspace FIFO Workspace Lane Queue/i.test(profile)) {
    addFinding(
      findings,
      "docs/protocols/PROFILE.md",
      "workspace_lane_queue_claim_without_implementation",
      "The current package has no separate per-workspace FIFO queue implementation."
    );
  }

  const docs = {
    "docs/protocols/PROFILE.md": profile,
    "docs/protocols/PROTOCOLS.md": await readIfExists("docs/protocols/PROTOCOLS.md"),
    "docs/TERM.md": await readIfExists("docs/TERM.md"),
    "docs/adr/0038-project-all-workspace-scoped-ledger-facts.md": await readIfExists("docs/adr/0038-project-all-workspace-scoped-ledger-facts.md")
  };
  const repairFactImplemented = /factType:\s*["']repair|recordRepair|appendRepair|repairId\s*:/i.test(code);
  for (const [file, text] of Object.entries(docs)) {
    if (
      !repairFactImplemented &&
      /Repair Facts?.*(?:include|includes|included|append|appended|recorded)|(?:append|appended|recorded).*Repair Facts?/is.test(text) &&
      !/reserved|does not append|does not execute|future repair executor/i.test(text)
    ) {
      addFinding(
        findings,
        file,
        "repair_fact_claim_without_implementation",
        "Docs must describe Repair Facts as reserved unless repair execution appends them."
      );
    }
  }

  const qualityGates = await readIfExists("docs/QUALITY-GATES.md");
  if (/CI must fail if a pressure profile regresses by more than 20%/i.test(qualityGates)) {
    addFinding(
      findings,
      "docs/QUALITY-GATES.md",
      "pressure_baseline_claim_without_implementation",
      "No checked-in pressure baseline comparator exists in the current release gate."
    );
  }

  const buildReadme = await readIfExists("build/README.md");
  const oldDataDirPattern = new RegExp(`\\.${"pact"}-${"server"}-data|${"repo"}:${"hygiene"}`, "i");
  for (const [pattern, detail] of [
    [/client-gui|client-cli|Flutter|Cargo|Vue server console/i, "build/README.md must not describe removed client/server build outputs."],
    [oldDataDirPattern, "build/README.md must not cite removed data directories or scripts."]
  ]) {
    if (pattern.test(buildReadme)) {
      addFinding(findings, "build/README.md", "stale_build_readme", detail);
    }
  }
}

async function main() {
  const findings = [];
  const files = await walk(root);
  verifyNoProcessStateDocs(files, findings);
  await verifyNoVersionOrganizedStructure(files, findings);
  await verifyToolingSurface(files, findings);
  await verifyRepositoryBoundaryDocs(findings);
  await verifyDesignImplementationAnchors(findings);
  await verifyNodeLtsMatrix(findings);
  await verifyPublishWorkflow(findings);
  await verifyPackageVersionDocs(findings);
  await verifyDocumentImplementationDrift(findings);

  if (findings.length > 0) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      checked: "pactium-release-readiness",
      findings
    }, null, 2)}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checked: "pactium-release-readiness",
    nodeLtsMajors: [22, 24]
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
