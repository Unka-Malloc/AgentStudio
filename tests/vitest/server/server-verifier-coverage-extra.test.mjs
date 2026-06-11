import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 300_000 });

const originalFetch = globalThis.fetch;
const originalProcessExit = process.exit;
const originalExitCode = process.exitCode;
const envSnapshot = { ...process.env };

class VerifierProcessExit extends Error {
  constructor(code = 0) {
    super(`verifier process.exit(${code})`);
    this.code = code;
  }
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(envSnapshot)) {
    process.env[key] = value;
  }
}

async function importVerifier(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set("vitestCoverageRun", `${Date.now()}-${Math.random()}`);
  const previousExit = process.exit;
  process.exit = (code = 0) => {
    throw new VerifierProcessExit(code);
  };
  try {
    await import(url.href);
  } catch (error) {
    if (!(error instanceof VerifierProcessExit) || Number(error.code || 0) !== 0) {
      throw error;
    }
  } finally {
    process.exit = previousExit;
  }
}

async function importVerifiers(relativePaths) {
  for (const relativePath of relativePaths) {
    await importVerifier(relativePath);
  }
}

function restoreProcessGlobals() {
  globalThis.fetch = originalFetch;
  process.exit = originalProcessExit;
  process.exitCode = originalExitCode;
  restoreEnv();
}

afterAll(() => {
  restoreProcessGlobals();
});

describe("server verifier coverage harness", () => {
  it("runs stable core verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-mcp-http.mjs",
      "../../../server/scripts/verify-maintenance-agent.mjs",
      "../../../server/scripts/verify-knowledge-kernel.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable authorization and continuity verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-opaque-capability-key.mjs",
      "../../../server/scripts/verify-capability-binding-guard.mjs",
      "../../../server/scripts/verify-transaction-continuity.mjs",
      "../../../server/scripts/verify-authorization-migration.mjs",
      "../../../server/scripts/verify-authorization-governance.mjs",
      "../../../server/scripts/verify-capability-security-helper.mjs",
      "../../../server/scripts/verify-security-hardening.mjs",
      "../../../server/scripts/verify-2-3-5-security-model.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable agent and capability verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-agent-workspace.mjs",
      "../../../server/scripts/verify-agent-session-governance.mjs",
      "../../../server/scripts/verify-agent-memory.mjs",
      "../../../server/scripts/verify-agent-gateway.mjs",
      "../../../server/scripts/verify-model-routing.mjs",
      "../../../server/scripts/verify-agent-exploration.mjs",
      "../../../server/scripts/verify-client-runtime-allocator.mjs",
      "../../../server/scripts/verify-client-runtime-bootstrap.mjs",
      "../../../server/scripts/verify-codespace-protocol.mjs",
      "../../../server/scripts/verify-v001-cloud-drive-e2e.mjs",
      "../../../server/scripts/verify-tool-management-platform.mjs",
      "../../../server/scripts/verify-tool-skill-management.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable knowledge and storage verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-knowledge-multimodal.mjs",
      "../../../server/scripts/verify-knowledge-maintenance.mjs",
      "../../../server/scripts/verify-knowledge-retrieval-quality.mjs",
      "../../../server/scripts/verify-knowledge-rule-authoring.mjs",
      "../../../server/scripts/verify-knowledge-outline.mjs",
      "../../../server/scripts/verify-knowledge-docx-export.mjs",
      "../../../server/scripts/verify-source-evidence-preview.mjs",
      "../../../server/scripts/verify-ops-tools.mjs",
      "../../../server/scripts/verify-checkpoint-lifecycle.mjs",
      "../../../server/scripts/verify-durable-workflow.mjs",
      "../../../server/scripts/verify-rebuild-metadata.mjs",
      "../../../server/scripts/verify-backup-restore.mjs",
      "../../../server/scripts/verify-context-compaction.mjs",
      "../../../server/scripts/verify-operation-policy.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable extended workflow verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-knowledge-console.mjs",
      "../../../server/scripts/verify-multi-source-connectors.mjs",
      "../../../server/scripts/verify-data-connector-governance.mjs",
      "../../../server/scripts/verify-knowledge-hierarchy.mjs",
      "../../../server/scripts/verify-external-knowledge-base.mjs",
      "../../../server/scripts/verify-agent-knowledge-tools.mjs",
      "../../../server/scripts/verify-agent-gateway-compaction.mjs",
      "../../../server/scripts/verify-agent-sync.mjs",
      "../../../server/scripts/verify-capability-package-lifecycle.mjs",
      "../../../server/scripts/verify-performance-capacity-benchmark.mjs",
      "../../../server/scripts/verify-mcp-agent-target-install.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable runtime and console verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-console-auth.mjs",
      "../../../server/scripts/verify-agent-workspace-file-upload.mjs",
      "../../../server/scripts/verify-workspace-local-dir-sync.mjs",
      "../../../server/scripts/verify-monitor-alerts.mjs",
      "../../../server/scripts/verify-maintenance-agent-compaction.mjs",
      "../../../server/scripts/verify-protocol-operation-registration.mjs",
      "../../../server/scripts/verify-state-mutations.mjs",
      "../../../server/scripts/verify-runtime-logging.mjs",
      "../../../server/scripts/verify-dispatcher-unified.mjs",
      "../../../server/scripts/verify-trace-context.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable architecture and governance verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-language-policy.mjs",
      "../../../server/scripts/verify-entity-config-layout.mjs",
      "../../../server/scripts/verify-platform-layout.mjs",
      "../../../server/scripts/verify-agent-client-support-targets.mjs",
      "../../../server/scripts/verify-composition-presets.mjs",
      "../../../server/scripts/verify-core-platform-provider.mjs",
      "../../../server/scripts/verify-module-ecosystem.mjs",
      "../../../server/scripts/verify-architecture-patterns.mjs",
      "../../../server/scripts/verify-platform-boundaries.mjs",
      "../../../server/scripts/verify-compatibility-layers.mjs",
      "../../../server/scripts/verify-gateway-ingress.mjs",
      "../../../server/scripts/verify-architecture-live-map.mjs",
      "../../../server/scripts/verify-knowledge-architecture-governance.mjs",
      "../../../server/scripts/verify-agent-library-access.mjs",
      "../../../server/scripts/verify-workspace-contribution-governance.mjs",
      "../../../server/scripts/verify-workspace-governance.mjs",
      "../../../server/scripts/verify-executive-report.mjs",
      "../../../server/scripts/verify-external-service-api-registration.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable document and storage verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-external-knowledge-distillation-service-gates.mjs",
      "../../../server/scripts/verify-v001-knowledge-e2e.mjs",
      "../../../server/scripts/verify-knowledge-markdown-chunking.mjs",
      "../../../server/scripts/verify-dynamic-document-parsing.mjs",
      "../../../server/scripts/verify-document-preview-consistency.mjs",
      "../../../server/scripts/verify-document-parser-dry-run.mjs",
      "../../../server/scripts/verify-asset-lineage.mjs",
      "../../../server/scripts/verify-singleton-boundaries.mjs",
      "../../../server/scripts/verify-state-coordination.mjs",
      "../../../server/scripts/verify-merkle-state-substrate.mjs",
      "../../../server/scripts/verify-v001-baseline.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable workspace and knowledge evolution verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-headless-server.mjs",
      "../../../server/scripts/verify-secret-init-cli.mjs",
      "../../../server/scripts/verify-workspace-checkpoint-protocol.mjs",
      "../../../server/scripts/verify-workspace-proposal-protocol.mjs",
      "../../../server/scripts/verify-v001-codespace-e2e.mjs",
      "../../../server/scripts/verify-workspace-file-ops.mjs",
      "../../../server/scripts/verify-knowledge-learning.mjs",
      "../../../server/scripts/verify-knowledge-evolution.mjs",
      "../../../server/scripts/verify-knowledge-evolution-loop.mjs",
      "../../../server/scripts/verify-knowledge-distillation-optimization.mjs",
      "../../../server/scripts/verify-knowledge-skillization.mjs",
      "../../../server/scripts/verify-knowledge-industrial-distillation.mjs",
      "../../../server/scripts/verify-multi-agent-summarization.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable security and scenario verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../server/scripts/verify-linux-security-backends.mjs",
      "../../../server/scripts/verify-windows-security-backends.mjs",
      "../../../server/scripts/verify-organization-model.mjs",
      "../../../server/scripts/verify-scenario-agent-code-submission.mjs",
      "../../../server/scripts/verify-scenario-catalog.mjs",
      "../../../server/scripts/verify-scenario-implementation-status.mjs",
      "../../../server/scripts/verify-unified-registration.mjs",
      "../../../server/scripts/verify-production-health-console.mjs",
      "../../../server/scripts/verify-sample-business-pack.mjs",
      "../../../server/scripts/verify-business-scenarios.mjs",
      "../../../server/scripts/verify-frontend-cache-storage.mjs",
      "../../../server/scripts/verify-frontend-feature-registry.mjs",
      "../../../server/scripts/verify-document-evaluation-corpus.mjs",
      "../../../server/scripts/verify-knowledge-distillation-standalone-service.mjs",
      "../../../server/scripts/verify-external-knowledge-distillation.mjs",
      "../../../server/scripts/verify-external-knowledge-distillation-references.mjs"
    ]);

    expect(true).toBe(true);
  });

  it("runs stable external adapter and MCP install verifier scripts inside Vitest coverage", async () => {
    await importVerifiers([
      "../../../tests/external-http-adapters/verify.mjs",
      "../../../server/scripts/verify-mcp-opencode.mjs",
      "../../../server/scripts/verify-mcp-codex-install.mjs"
    ]);

    expect(true).toBe(true);
  });
});
