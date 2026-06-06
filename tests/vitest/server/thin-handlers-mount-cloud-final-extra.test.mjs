import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cloudMocks = vi.hoisted(() => ({
  createCloudDrivePort: vi.fn()
}));

vi.mock("../../../server/platform/specialized/agent/cloud-drive-port/index.mjs", () => ({
  createCloudDrivePort: cloudMocks.createCloudDrivePort
}));

import { createSystemControllerAgentSettingsHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-agent-settings-handlers.mjs";
import {
  getMountConfigPaths,
  loadMountConfig,
  mergeMountRouting,
  normalizeModulePath,
  normalizeMountModules,
  normalizeMountRouting,
  saveMountConfig
} from "../../../server/platform/common/module-manager/mount-config.mjs";
import {
  CLOUD_DRIVE_UPSTREAM_GATEWAY_PROTOCOL_VERSION,
  CLOUD_DRIVE_UPSTREAM_SERVICE_ID,
  CLOUD_DRIVE_UPSTREAM_TYPE,
  createCloudDriveUpstreamGateway,
  isCloudDriveUpstreamGatewayOperation
} from "../../../server/platform/specialized/console/cloud-drive-upstream-gateway.mjs";

const tempDirs = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-thin-final-extra-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.PACT_IMPORT_FILE_TYPES_PATH;
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("agent settings thin handlers final extra coverage", () => {
  it("forwards each handler to the console operation bridge with parsed input and context", async () => {
    const sendConsoleDomainOperation = vi.fn(async () => undefined);
    const parseJsonBody = vi.fn((body) => ({ parsed: body }));
    const settingsAgentGatewayContext = vi.fn((authSession) => ({
      scope: "settings",
      userId: authSession?.userId
    }));
    const response = { tag: "response" };
    const authSession = { userId: "u-1" };
    const handlers = createSystemControllerAgentSettingsHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      settingsAgentGatewayContext
    });

    await handlers.handleGetSettings({ operation: { id: "settings.custom_get" }, authSession, response });
    await handlers.handleSetSettings({ operation: null, requestBody: "{\"theme\":\"dark\"}", authSession, response });
    await handlers.handleProbeModel({ operation: null, requestBody: "{\"model\":\"m\"}", authSession, response });
    await handlers.handleAgentGatewayConfig({ operation: null, requestBody: "", authSession, response });
    await handlers.handleAgentGatewayConfig({ operation: null, requestBody: "{\"enabled\":true}", authSession, response });
    await handlers.handleAgentGatewayCall({ operation: null, requestBody: "{\"method\":\"ping\"}", authSession, response });
    await handlers.handleAgentRegistry({ operation: null, authSession, response });
    await handlers.handleModelRoutingHealth({
      operation: null,
      url: new URL("http://unit.test/model-routing/health?limit=7"),
      authSession,
      response
    });
    await handlers.handleCreateAgent({ operation: null, requestBody: "{\"name\":\"agent\"}", authSession, response });
    await handlers.handleUpdateAgent({
      operation: null,
      agentId: "agent-1",
      requestBody: "{\"name\":\"renamed\"}",
      authSession,
      response
    });
    await handlers.handleDeleteAgent({ operation: null, agentId: "agent-1", authSession, response });

    expect(sendConsoleDomainOperation.mock.calls.map(([input]) => input.operationId)).toEqual([
      "settings.custom_get",
      "settings.set",
      "settings.model_probe",
      "agent_gateway.config.get",
      "agent_gateway.config.set",
      "agent_gateway.call",
      "agents.list",
      "model_routing.health",
      "agents.create",
      "agents.update",
      "agents.delete"
    ]);
    expect(sendConsoleDomainOperation.mock.calls[1][0]).toMatchObject({
      input: { parsed: "{\"theme\":\"dark\"}" },
      response,
      context: { scope: "settings", userId: "u-1" },
      errorMessage: "保存设置失败。"
    });
    expect(sendConsoleDomainOperation.mock.calls[3][0].input).toEqual({});
    expect(sendConsoleDomainOperation.mock.calls[7][0].input).toEqual({ limit: 7 });
    expect(sendConsoleDomainOperation.mock.calls[9][0].input).toEqual({
      parsed: "{\"name\":\"renamed\"}",
      agentId: "agent-1"
    });
    expect(sendConsoleDomainOperation.mock.calls[10][0]).toMatchObject({
      input: { agentId: "agent-1" },
      errorMessage: "删除智能体模型配置失败。"
    });
    expect(settingsAgentGatewayContext).toHaveBeenCalledTimes(11);
  });
});

describe("mount config final extra coverage", () => {
  async function installDefaultImportRoutes() {
    const dir = await createTempDir();
    const filePath = path.join(dir, "default-import-routes.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        kindRoutes: {
          email: { mount: "documentParser", capability: "extractMail" },
          ignored: { mount: "" }
        },
        groups: [
          {
            route: { mount: "pdfProcessor", capability: "extractPdf" },
            mediaTypes: ["application/group-default"],
            entries: [
              {
                extensions: ["PDF", ".TXT"],
                mediaTypes: ["application/pdf"],
                route: { mountName: "documentParser", action: "extractDocument" }
              }
            ]
          }
        ]
      }),
      "utf8"
    );
    process.env.PACT_IMPORT_FILE_TYPES_PATH = filePath;
  }

  it("normalizes modules and routing with default import routes and patch overrides", async () => {
    await installDefaultImportRoutes();

    expect(normalizeModulePath("  ./module.mjs  ")).toBe("./module.mjs");
    expect(normalizeMountModules({
      documentParser: "  ./parser.mjs ",
      customMount: " ./custom.mjs ",
      mountRouting: "ignored"
    })).toMatchObject({
      analysis: "",
      documentParser: "./parser.mjs",
      customMount: "./custom.mjs"
    });

    const routing = normalizeMountRouting({
      kindRoutes: {
        email: { mountName: "mailParser", action: "extractMailbox" }
      },
      extensionRoutes: {
        DOCX: { mount: "docxParser", capability: "extractDocx" }
      },
      mediaTypeRoutes: {
        "TEXT/PLAIN": { mountName: "textParser", action: "extractText" }
      }
    });

    expect(routing.kindRoutes.email).toEqual({ mountName: "mailParser", action: "extractMailbox" });
    expect(routing.extensionRoutes[".pdf"]).toEqual({ mountName: "documentParser", action: "extractDocument" });
    expect(routing.extensionRoutes[".txt"]).toEqual({ mountName: "documentParser", action: "extractDocument" });
    expect(routing.extensionRoutes.docx).toEqual({ mountName: "docxParser", action: "extractDocx" });
    expect(routing.mediaTypeRoutes["application/pdf"]).toEqual({ mountName: "documentParser", action: "extractDocument" });
    expect(routing.mediaTypeRoutes["application/group-default"]).toEqual({
      mountName: "documentParser",
      action: "extractDocument"
    });
    expect(routing.mediaTypeRoutes["text/plain"]).toEqual({ mountName: "textParser", action: "extractText" });

    expect(mergeMountRouting(
      { extensionRoutes: { ".md": { mountName: "markdownA", action: "extractA" } } },
      { extensionRoutes: { ".md": { mountName: "markdownB", action: "extractB" } } }
    ).extensionRoutes[".md"]).toEqual({ mountName: "markdownB", action: "extractB" });
  });

  it("loads, saves, and merges split mount module and routing config files", async () => {
    await installDefaultImportRoutes();
    const userDataPath = await createTempDir();
    const paths = getMountConfigPaths(userDataPath);

    const first = await saveMountConfig(userDataPath, {
      documentParser: " ./modules/document-parser.mjs ",
      customMount: " ./modules/custom.mjs ",
      mountRouting: {
        extensionRoutes: {
          ".md": { mountName: "documentParser", action: "extractMarkdown" }
        }
      }
    });

    expect(first.mountModules).toMatchObject({
      analysis: "",
      documentParser: "./modules/document-parser.mjs",
      customMount: "./modules/custom.mjs"
    });
    expect(first.mountRouting.kindRoutes.email).toEqual({ mountName: "documentParser", action: "extractMail" });
    expect(JSON.parse(await fs.readFile(paths.modulesPath, "utf8"))).toMatchObject({
      documentParser: "./modules/document-parser.mjs",
      customMount: "./modules/custom.mjs"
    });

    const second = await saveMountConfig(userDataPath, {
      mountModules: {
        documentParser: "./modules/document-parser-v2.mjs"
      },
      mountRouting: {
        mediaTypeRoutes: {
          "text/markdown": { mountName: "documentParser", action: "extractMarkdown" }
        }
      }
    });
    const loaded = await loadMountConfig(userDataPath);

    expect(second.mountModules).toMatchObject({
      documentParser: "./modules/document-parser-v2.mjs",
      customMount: "./modules/custom.mjs"
    });
    expect(loaded.mountRouting.extensionRoutes[".md"]).toEqual({
      mountName: "documentParser",
      action: "extractMarkdown"
    });
    expect(loaded.mountRouting.mediaTypeRoutes["text/markdown"]).toEqual({
      mountName: "documentParser",
      action: "extractMarkdown"
    });
    expect(JSON.parse(await fs.readFile(paths.routingPath, "utf8")).mediaTypeRoutes["text/markdown"]).toEqual({
      mountName: "documentParser",
      action: "extractMarkdown"
    });
  });
});

describe("cloud drive upstream gateway final extra coverage", () => {
  it("routes modern and legacy operations, annotates object payloads, and handles passthroughs", async () => {
    const port = {
      connect: vi.fn(async (input) => ({ connected: true, input })),
      uploadFile: vi.fn(async (input) => ({ uploaded: true, input })),
      status: vi.fn(async () => "plain-status")
    };
    cloudMocks.createCloudDrivePort.mockReturnValue(port);

    const gateway = createCloudDriveUpstreamGateway({ userDataPath: "/tmp/cloud" });

    expect(cloudMocks.createCloudDrivePort).toHaveBeenCalledWith({ userDataPath: "/tmp/cloud" });
    expect(gateway).toMatchObject({
      protocolVersion: CLOUD_DRIVE_UPSTREAM_GATEWAY_PROTOCOL_VERSION,
      serviceId: CLOUD_DRIVE_UPSTREAM_SERVICE_ID,
      upstreamType: CLOUD_DRIVE_UPSTREAM_TYPE
    });
    expect(isCloudDriveUpstreamGatewayOperation(" external.cloudDrive.connect ")).toBe(true);
    expect(isCloudDriveUpstreamGatewayOperation("external.cloudDrive.unknown")).toBe(false);

    const modern = await gateway.execute({
      operationId: " external.cloudDrive.connect ",
      input: { workspaceId: "ws-1" }
    });
    expect(port.connect).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      operationId: "external.cloudDrive.connect"
    });
    expect(modern).toMatchObject({
      status: 200,
      payload: {
        connected: true,
        upstreamService: {
          protocolVersion: CLOUD_DRIVE_UPSTREAM_GATEWAY_PROTOCOL_VERSION,
          serviceId: CLOUD_DRIVE_UPSTREAM_SERVICE_ID,
          upstreamType: CLOUD_DRIVE_UPSTREAM_TYPE,
          operationId: "external.cloudDrive.connect",
          legacyOperationId: "sharedspace.drive.connect",
          gatewayAspect: "upstream-service"
        }
      }
    });

    const legacy = await gateway.execute({
      operationId: "sharedspace.drive.file.upload",
      input: { path: "a.txt" }
    });
    expect(legacy).toMatchObject({
      status: 201,
      payload: {
        uploaded: true,
        upstreamService: {
          operationId: "sharedspace.drive.file.upload",
          replacementOperationId: "external.cloudDrive.file.upload"
        }
      }
    });
    expect(await gateway.execute({ operationId: "external.cloudDrive.status" })).toEqual({
      status: 200,
      payload: "plain-status"
    });
    expect(await gateway.execute({ operationId: "missing.operation" })).toBeNull();
  });

  it("throws a clear error when a configured cloud-drive method is absent", async () => {
    cloudMocks.createCloudDrivePort.mockReturnValue({});
    const gateway = createCloudDriveUpstreamGateway({ userDataPath: "/tmp/cloud" });

    await expect(gateway.execute({ operationId: "external.cloudDrive.file.download" }))
      .rejects.toThrow("Cloud drive upstream gateway method is not available: downloadFile");
  });
});
