import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, it, vi } from "vitest";

import {
  createAcpSourceStdioServer,
  createAcpSourceStdioServerOptionsFromEnv,
  runAcpSourceStdioServerFromEnv
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs";
import { AcpSourceOperationGuard } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-operation-guard.mjs";

const tempDirs = [];

async function makeTempDir(prefix = "pact-acp-stdio-guard-env-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function captureStream(stream) {
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk).toString("utf8")));
  return () => chunks.join("");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("agent relay stdio/env and source guard coverage", () => {
  it("covers stdio env parsing, store adapter injection, diagnostics, and runtime validation", async () => {
    assert.throws(() => createAcpSourceStdioServer(), /requires a relay runtime/);
    assert.deepEqual(createAcpSourceStdioServerOptionsFromEnv({}), {
      runtimeOptions: {},
      context: {}
    });
    assert.throws(() => createAcpSourceStdioServerOptionsFromEnv({
      PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: "{bad-json"
    }), /Invalid JSON environment configuration/);

    const root = await makeTempDir();
    const storePath = path.join(root, "relay-store.json");
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const diagnosticsText = captureStream(diagnostics);

    input.end();
    const result = await runAcpSourceStdioServerFromEnv({
      env: {
        PACT_ACP_SOURCE_STDIO_STORE_PATH: storePath,
        PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify({}),
        PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
          sourceScopes: ["context.scope"],
          sourceCapabilities: ["context.capability"],
          sourceIdentity: { fromContext: true }
        }),
        PACT_ACP_SOURCE_ID: "source-env",
        PACT_ACP_SOURCE_SUBJECT_ID: "subject-env",
        PACT_ACP_WORKSPACE_ID: "workspace-env",
        PACT_ACP_SOURCE_SCOPES: "env.scope other.scope",
        PACT_ACP_SOURCE_CAPABILITIES: "env.capability,other.capability",
        PACT_ACP_SOURCE_IDENTITY_JSON: JSON.stringify({ fromEnv: true })
      },
      input,
      output,
      diagnostics,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    });

    assert.deepEqual(result, { ok: true });
    const status = JSON.parse(diagnosticsText().trim());
    assert.equal(status.event, "pact.acp.source_stdio.ready");
    assert.equal(status.sourceId, "source-env");
    assert.equal(status.workspaceId, "workspace-env");
    assert.equal(status.durableStore, true);
    assert.equal(status.storagePath, storePath);
  });

  it("covers source operation guard no-provider and authorizeOperation branches", async () => {
    const noProvider = new AcpSourceOperationGuard();
    const noProviderDecision = await noProvider.preflight({
      operationId: "custom.relay.list",
      input: {}
    });
    assert.equal(noProviderDecision.ok, true);
    assert.equal(noProviderDecision.decision, null);
    assert.equal(noProviderDecision.operation.readOnly, true);
    assert.deepEqual(noProviderDecision.operation.requiredScopes, ["agent_relay:view"]);

    const appendDenied = vi.fn();
    const authorizeDenied = {
      authorizeOperation: vi.fn(async () => ({
        ok: false,
        status: 451,
        reasonCode: "source_geo_blocked",
        error: "Source ACP operation denied by region policy.",
        missingScopes: ["agent_relay:operate"],
        missingCapabilities: ["cap:api:agent-relay"],
        authorizationDecision: {
          effect: "deny",
          allowed: false,
          reasonCode: "source_geo_blocked",
          redactedReason: "Source ACP operation denied by region policy.",
          missingCapabilities: ["cap:api:agent-relay"],
          evaluatedLayers: ["authorize_operation"]
        }
      })),
      appendDecision: appendDenied
    };
    const deniedGuard = new AcpSourceOperationGuard({ securityPermissions: authorizeDenied });
    const denied = await deniedGuard.preflight({
      operationId: "custom.relay.write",
      input: {
        sourceId: "source-authz",
        sourceScopes: ["agent_relay:view"]
      },
      context: { transport: "source-json-rpc" }
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.status, 451);
    assert.equal(denied.error.code, "source_geo_blocked");
    assert.equal(denied.error.details.missingCapabilities[0], "cap:api:agent-relay");
    assert.equal(appendDenied.mock.calls.length, 1);
    assert.equal(authorizeDenied.authorizeOperation.mock.calls[0][0].method, "ACP");

    const appendAllowed = vi.fn();
    const authorizeAllowed = {
      authorizeOperation: vi.fn(async () => ({
        ok: true,
        authorizationDecision: {
          effect: "allow",
          allowed: true,
          reasonCode: "source_allowed_by_authorize_operation",
          redactedReason: "Allowed by source authorizeOperation.",
          evaluatedLayers: ["authorize_operation"]
        }
      })),
      appendDecision: appendAllowed
    };
    const allowedGuard = new AcpSourceOperationGuard({ securityPermissions: authorizeAllowed });
    const allowed = await allowedGuard.preflight({
      operationId: "custom.relay.get",
      input: {
        authorizationSubject: {
          subjectId: "subject-direct",
          scopes: ["agent_relay:view"]
        }
      }
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.decision.reasonCode, "source_allowed_by_authorize_operation");
    assert.equal(appendAllowed.mock.calls.length, 1);
  });
});
