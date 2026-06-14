import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { afterEach, describe, it, vi } from "vitest";

import {
  createAcpSourceStdioServer,
  createAcpSourceStdioServerOptionsFromEnv,
  runAcpSourceStdioServerFromEnv
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs";
import { AcpSourceOperationGuard } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-operation-guard.mjs";

const tempDirs = [];

function captureStream(stream) {
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk).toString("utf8")));
  return () => chunks.join("");
}

afterEach(async () => {
  vi.restoreAllMocks();
  tempDirs.splice(0);
});

describe("agent relay stdio/env and source guard coverage", () => {
  it("fails closed for source-facing local stdio helpers", async () => {
    assert.throws(() => createAcpSourceStdioServer(), /Pact no longer exposes local stdio interfaces/);
    assert.throws(
      () => createAcpSourceStdioServerOptionsFromEnv({}),
      /Pact no longer exposes local stdio interfaces/
    );

    const diagnostics = new PassThrough();
    const diagnosticsText = captureStream(diagnostics);
    const result = await runAcpSourceStdioServerFromEnv({
      diagnostics,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "local_stdio_interface_disabled");
    const status = JSON.parse(diagnosticsText().trim());
    assert.equal(status.event, "pact.acp.source_stdio.disabled");
    assert.equal(status.error.code, "local_stdio_interface_disabled");
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
