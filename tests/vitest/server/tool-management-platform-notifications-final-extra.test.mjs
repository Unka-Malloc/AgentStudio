import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const broadcastToolListChangedMock = vi.hoisted(() => vi.fn(() => ({
  method: "notifications/tools/list_changed",
  deliveredConnectionCount: 2
})));
const listVirtualOperationsSyncMock = vi.hoisted(() => vi.fn(() => []));
const invalidateRuntimeStateMock = vi.hoisted(() => vi.fn(() => ({
  ok: true,
  serviceId: "svc-1",
  reasonCode: "external_service_catalog_rolled_back",
  scopes: ["mcp-tools-list", "upstream-session"],
  inFlightTrackedCount: 0,
  inFlightAbortedCount: 0,
  upstreamSessionInvalidatedCount: 0,
  runtimeCacheInvalidated: false,
  healthStateInvalidated: 0
})));
const createExternalPassthroughRuntimeMock = vi.hoisted(() => vi.fn(() => ({
  listVirtualOperationsSync: listVirtualOperationsSyncMock,
  invalidateRuntimeState: invalidateRuntimeStateMock
})));

vi.mock("../../../server/platform/common/mcp/http-mcp-adapter.mjs", () => ({
  broadcastMcpToolListChanged: broadcastToolListChangedMock
}));

vi.mock("../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs", () => ({
  createExternalMcpPassthroughRuntime: createExternalPassthroughRuntimeMock
}));

import {
  createToolManagementPlatform
} from "../../../server/platform/specialized/capabilities/tools/tool-management-core/index.mjs";

async function withTempUserDataPath(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-platform-notifications-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function operationFixture() {
  return {
    id: "unit.tool.read",
    feature: "unit",
    label: "Unit tool read",
    target: { controller: "unit", method: "read" },
    http: { method: "GET", path: "/api/unit/tool" },
    rpc: { method: "unit.tool.read" },
    cli: { command: ["unit", "tool", "read"], usage: "unit tool read" },
    requiredScopes: ["unit:read"],
    readOnly: true,
    concurrencySafe: true,
    aspects: ["unit"],
    safety: {
      risk: "read_only",
      readOnly: true,
      requiresConfirmation: false
    },
    audit: { enabled: true },
    log: { enabled: true },
    inputSchema: { type: "object", additionalProperties: true }
  };
}

describe("tool-management platform notification coverage", () => {
  it("continues catalog notifications through async and failing handlers", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const asyncHandler = vi.fn(async () => ({ ok: true }));
      const failingHandler = vi.fn(() => {
        throw new Error("handler failed");
      });
      const publish = vi.fn(async () => ({ ok: true }));
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      const platform = createToolManagementPlatform({
        userDataPath,
        operations: [operationFixture()],
        controllers: { unit: { read: vi.fn() } },
        protocolEventBus: { publish },
        changeHandlers: [asyncHandler, failingHandler],
        logger
      });

      try {
        platform.store.saveCatalogSnapshot({
          fingerprint: "unit-notification-extra",
          tools: [],
          toolsets: [],
          profiles: []
        });
        await platform.store.flushChangeNotifications();

        expect(asyncHandler).toHaveBeenCalledWith(expect.objectContaining({
          reasonCode: expect.any(String),
          notification: expect.objectContaining({
            deliveredConnectionCount: 2
          })
        }));
        expect(failingHandler).toHaveBeenCalled();
        expect(publish).toHaveBeenCalledWith(
          "tool_management.mcp_catalog_changed",
          expect.objectContaining({
            notification: expect.objectContaining({
              deliveredConnectionCount: 2
            })
          }),
          { delivery: "best-effort" }
        );
        expect(logger.debug).toHaveBeenCalledWith(
          "tool_management.mcp.list_changed",
          expect.objectContaining({
            deliveredConnectionCount: 2
          })
        );
        expect(broadcastToolListChangedMock).toHaveBeenCalled();
        expect(createExternalPassthroughRuntimeMock).toHaveBeenCalledWith(expect.objectContaining({
          userDataPath,
          logger
        }));

        broadcastToolListChangedMock.mockClear();
        listVirtualOperationsSyncMock.mockClear();
        invalidateRuntimeStateMock.mockClear();
        const refresh = platform.refreshExternalServiceTools({
          source: "external-service-registry",
          type: "external_service_catalog_rolled_back",
          reasonCode: "external_service_catalog_rolled_back",
          serviceId: "svc-1",
          activeVersionId: "active-v2",
          candidateVersionId: "candidate-v3",
          manifestFingerprint: "manifest-fp",
          invalidation: {
            reasonCode: "rollback_requires_runtime_reprojection",
            scopes: ["mcp-tools-list", "upstream-session"]
          }
        });
        expect(refresh).toMatchObject({
          ok: true,
          fingerprint: expect.any(String),
          runtimeInvalidation: {
            ok: true,
            serviceId: "svc-1",
            scopes: expect.arrayContaining(["mcp-tools-list", "upstream-session"]),
            inFlightTrackedCount: 0,
            healthStateInvalidated: 0
          }
        });
        expect(invalidateRuntimeStateMock).toHaveBeenCalledWith(expect.objectContaining({
          reasonCode: "external_service_catalog_rolled_back",
          serviceId: "svc-1",
          invalidation: expect.objectContaining({
            reasonCode: "rollback_requires_runtime_reprojection",
            scopes: expect.arrayContaining(["mcp-tools-list", "upstream-session"])
          })
        }));
        expect(invalidateRuntimeStateMock.mock.invocationCallOrder[0]).toBeLessThan(
          listVirtualOperationsSyncMock.mock.invocationCallOrder[0]
        );
        expect(broadcastToolListChangedMock).toHaveBeenCalledWith(expect.objectContaining({
          reasonCode: "external_service_catalog_rolled_back",
          details: expect.objectContaining({
            serviceId: "svc-1",
            activeVersionId: "active-v2",
            candidateVersionId: "candidate-v3",
            manifestFingerprint: "manifest-fp",
            invalidation: expect.objectContaining({
              reasonCode: "rollback_requires_runtime_reprojection",
              scopes: expect.arrayContaining(["mcp-tools-list", "upstream-session"])
            })
          })
        }));
      } finally {
        platform.close();
      }
    });
  });
});
