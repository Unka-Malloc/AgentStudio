import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXTERNAL_SERVICE_MODEL_PROTOCOL,
  EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES,
  EXTERNAL_SERVICE_UPSTREAM_TYPE
} from "../../../server/platform/common/composition-management/external-service-adapter.mjs";
import {
  callExternalLlmService,
  describeExternalLlmServiceAdapters,
  dispatchExternalLlmServiceAdapter,
  isExternalLlmServiceConfig,
  resolveExternalLlmServiceAdapter
} from "../../../server/platform/common/composition-management/external-llm-service-adapters.mjs";
import {
  buildMcpHandshakePayload,
  loadOrCreateMcpIdentity,
  publicMcpIdentity,
  signMcpHandshake,
  stableStringify,
  verifyMcpHandshakeSignature
} from "../../../server/platform/common/mcp/identity.mjs";

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-llm-mcp-identity-extra-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("external LLM adapters and MCP identity extra coverage", () => {
  it("describes and dispatches scaffold LLM adapters for every registered protocol", () => {
    const description = describeExternalLlmServiceAdapters();
    expect(description).toMatchObject({
      kind: "pact.external-llm-service.adapter-registry",
      status: "scaffold"
    });
    expect(description.protocols).toHaveLength(EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES.length);
    expect(description.protocols.every((entry) => entry.registered)).toBe(true);

    expect(isExternalLlmServiceConfig({ upstream: { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM } })).toBe(true);
    expect(isExternalLlmServiceConfig({ upstream: { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC } })).toBe(false);

    for (const protocol of EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES) {
      const result = dispatchExternalLlmServiceAdapter({
        config: { upstream: { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM, modelProtocol: protocol } },
        input: { prompt: "hello" },
        context: { traceId: protocol }
      });
      expect(result).toMatchObject({
        ok: false,
        status: "not_implemented",
        adapterId: protocol,
        input: { prompt: "hello" },
        context: { traceId: protocol }
      });
    }

    expect(resolveExternalLlmServiceAdapter("unknown-protocol")({
      config: {},
      input: { prompt: "fallback" }
    })).toMatchObject({
      adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP,
      input: { prompt: "fallback" }
    });
    expect(callExternalLlmService({ config: {}, input: { prompt: "default" } })).toMatchObject({
      adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP
    });
  });

  it("creates, reloads, signs, verifies, and rejects invalid MCP identities", async () => {
    await withTempRoot(async (root) => {
      const identity = await loadOrCreateMcpIdentity(root);
      expect(identity).toMatchObject({
        schemaVersion: "v0.0.1:mcp:identity-1",
        algorithm: "Ed25519"
      });
      expect(identity.keyId).toMatch(/^ed25519:/);

      const reloaded = await loadOrCreateMcpIdentity(root);
      expect(reloaded.keyId).toBe(identity.keyId);
      expect(publicMcpIdentity(identity)).toEqual({
        schemaVersion: "v0.0.1:mcp:identity-1",
        algorithm: "Ed25519",
        keyId: identity.keyId,
        publicKeyJwk: identity.publicKeyJwk
      });

      const payload = buildMcpHandshakePayload({
        nonce: "nonce-1",
        issuedAt: "2026-06-05T00:00:00.000Z",
        identity,
        discovery: {
          serverId: "server-1",
          serverVersion: "1.2.3",
          interfaceVersion: "iface-1",
          toolsetVersion: "tools-1",
          stableToolName: "pact"
        },
        baseUrl: "http://127.0.0.1:3000",
        vmBaseUrl: "http://vm.local"
      });
      expect(payload.endpoints).toMatchObject({
        mcpUrl: "http://127.0.0.1:3000/mcp",
        vmMcpUrl: "http://vm.local/mcp"
      });
      expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe("{\"a\":{\"c\":3,\"d\":4},\"b\":2}");

      const signature = signMcpHandshake({ identity, payload });
      expect(signature).toMatchObject({
        algorithm: "Ed25519",
        payloadEncoding: "v0.0.1:platform:stable-json-1"
      });
      expect(verifyMcpHandshakeSignature({
        publicKeyJwk: identity.publicKeyJwk,
        payload,
        signature: signature.value
      })).toBe(true);
      expect(verifyMcpHandshakeSignature({
        publicKeyJwk: identity.publicKeyJwk,
        payload: { ...payload, nonce: "tampered" },
        signature: signature.value
      })).toBe(false);

      await fs.writeFile(path.join(root, "mcp-identity.json"), "{\"schemaVersion\":\"bad\"}\n", "utf8");
      await expect(loadOrCreateMcpIdentity(root)).rejects.toThrow("Invalid MCP identity file.");
    });
  });
});
