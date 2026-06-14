import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SERVER_PORT,
  getDefaultServerUrl
} from "../../../server/config/ServerEnv.mjs";
import { ServerConfig } from "../../../server/platform/common/config/ServerConfig.mjs";
import {
  registerCorePlatformServices
} from "../../../server/platform/common/platform-core/register.mjs";
import {
  registerDataStructurePlatformServices
} from "../../../server/platform/common/data-structure/register.mjs";
import {
  createDevopsProvider
} from "../../../server/platform/common/devops/devops-provider.mjs";
import {
  registerDevopsPlatformServices
} from "../../../server/platform/common/devops/register.mjs";
import {
  registerModuleManagementPlatformServices
} from "../../../server/platform/common/module-manager/register.mjs";
import {
  createPlatformRegistry
} from "../../../server/platform/interactive/platform-registry.mjs";

const tempRoots = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

describe("platform entrypoints final coverage", () => {
  it("normalizes server URLs from explicit, environment, and invalid ports", () => {
    const originalPort = process.env.PACT_SERVER_PORT;
    try {
      delete process.env.PACT_SERVER_PORT;
      expect(DEFAULT_SERVER_PORT).toBe(7228);
      expect(getDefaultServerUrl()).toBe("http://127.0.0.1:7228");
      expect(getDefaultServerUrl({ port: 7333 })).toBe("http://127.0.0.1:7333");
      expect(getDefaultServerUrl({ port: "not-a-port" })).toBe("http://127.0.0.1:7228");

      process.env.PACT_SERVER_PORT = "7444";
      expect(getDefaultServerUrl()).toBe("http://127.0.0.1:7444");

      process.env.PACT_SERVER_PORT = "70000";
      expect(getDefaultServerUrl()).toBe("http://127.0.0.1:7228");
    } finally {
      if (originalPort === undefined) {
        delete process.env.PACT_SERVER_PORT;
      } else {
        process.env.PACT_SERVER_PORT = originalPort;
      }
    }
  });

  it("keeps ServerConfig data directory fallbacks stable", async () => {
    const originalDataDir = process.env.PACT_SERVER_DATA_DIR;
    try {
      delete process.env.PACT_SERVER_DATA_DIR;
      expect(ServerConfig.getDataDir()).toContain(".pact-server-data");

      const root = await tempDir("pact-server-config-final-extra-");
      process.env.PACT_SERVER_DATA_DIR = path.join(root, "data");
      expect(ServerConfig.getDataDir()).toBe(path.join(root, "data"));
    } finally {
      if (originalDataDir === undefined) {
        delete process.env.PACT_SERVER_DATA_DIR;
      } else {
        process.env.PACT_SERVER_DATA_DIR = originalDataDir;
      }
    }
  });

  it("falls back from unreadable JSON config files", async () => {
    const originalConfigFile = process.env.PACT_CONFIG_FILE;
    const originalDataDir = process.env.PACT_SERVER_DATA_DIR;
    const root = await tempDir("pact-server-config-invalid-extra-");
    const configPath = path.join(root, "invalid.json");
    await fs.writeFile(configPath, "{ invalid json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.PACT_CONFIG_FILE = configPath;
      process.env.PACT_SERVER_DATA_DIR = path.join(root, "env-data");
      vi.resetModules();
      const imported = await import("../../../server/platform/common/config/ServerConfig.mjs");
      expect(imported.ServerConfig.getDataDir()).toBe(path.join(root, "env-data"));
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      if (originalConfigFile === undefined) {
        delete process.env.PACT_CONFIG_FILE;
      } else {
        process.env.PACT_CONFIG_FILE = originalConfigFile;
      }
      if (originalDataDir === undefined) {
        delete process.env.PACT_SERVER_DATA_DIR;
      } else {
        process.env.PACT_SERVER_DATA_DIR = originalDataDir;
      }
      vi.resetModules();
    }
  });

  it("registers DevOps platform closures and delegates provider calls", async () => {
    const registry = createPlatformRegistry({ scope: "unit" });
    const provider = {
      protocolVersion: "v0.0.1:test:devops-1",
      listCapabilities: vi.fn(() => ({
        capabilities: [{ id: "process-status" }, { id: "monitor-alerts" }]
      })),
      getBackgroundProcessStatus: vi.fn((input) => ({ kind: "process", input })),
      getMonitorAlertState: vi.fn((input) => ({ kind: "state", input })),
      saveMonitorAlertConfig: vi.fn((input) => ({ kind: "save", input })),
      runMonitorAlertCycle: vi.fn((input) => ({ kind: "cycle", input })),
      acknowledgeMonitorAlert: vi.fn((input) => ({ kind: "ack", input })),
      recoverBackgroundSupervisor: vi.fn((input) => ({ kind: "recover", input }))
    };

    const registered = registerDevopsPlatformServices(registry, { devopsProvider: provider });
    expect(registered.map((entry) => entry.id)).toEqual([
      "devops.provider",
      "devops.processStatus.get",
      "devops.monitorAlerts.state",
      "devops.monitorAlerts.saveConfig",
      "devops.monitorAlerts.runCycle",
      "devops.monitorAlerts.acknowledge",
      "devops.backgroundSupervisor.recover",
      "devops.unifiedRegistration.normalize",
      "devops.unifiedRegistration.composeStatus"
    ]);
    expect(registry.get("devops.provider").metadata.capabilityIds).toEqual(["process-status", "monitor-alerts"]);

    expect(await registry.callInterface("devops.processStatus.get", { limit: 1 })).toEqual({
      kind: "process",
      input: { limit: 1 }
    });
    expect(await registry.callInterface("devops.monitorAlerts.state", { filter: "open" })).toEqual({
      kind: "state",
      input: { filter: "open" }
    });
    expect(await registry.callInterface("devops.monitorAlerts.saveConfig", { enabled: true })).toEqual({
      kind: "save",
      input: { enabled: true }
    });
    expect(await registry.callInterface("devops.monitorAlerts.runCycle", { dryRun: true })).toEqual({
      kind: "cycle",
      input: { dryRun: true }
    });
    expect(await registry.callInterface("devops.monitorAlerts.acknowledge", { id: "alert-1" })).toEqual({
      kind: "ack",
      input: { id: "alert-1" }
    });
    expect(await registry.callInterface("devops.backgroundSupervisor.recover", { force: true })).toEqual({
      kind: "recover",
      input: { force: true }
    });

    const builtinProvider = createDevopsProvider({ userDataPath: "/tmp/pact-devops-provider-extra" });
    await expect(builtinProvider.recoverBackgroundSupervisor({
      platform: "linux",
      backgroundStatus: {}
    })).resolves.toMatchObject({
      ok: false,
      attempted: false,
      reason: "unsupported_platform"
    });
  });

  it("registers core, data-structure, and module-management platform fallbacks", async () => {
    const coreRegistry = createPlatformRegistry({ scope: "core-unit" });
    const coreProvider = {
      protocolVersion: "v0.0.1:test:core-1",
      listCapabilities: vi.fn(() => ({ capabilities: [{ id: "operations" }] })),
      describeOperationRegistry: vi.fn((input) => ({ ok: true, input }))
    };
    registerCorePlatformServices(coreRegistry, {
      coreProvider,
      protocolEventBus: { id: "events" },
      runtimeLogger: { id: "logger" },
      featureRuntime: { id: "features" },
      operationConcurrencyScope: "unit-scope"
    });
    expect(coreRegistry.get("core.provider").metadata.capabilityIds).toEqual(["operations"]);
    expect(await coreRegistry.callInterface("core.operations.registry", { verbose: true })).toEqual({
      ok: true,
      input: { verbose: true }
    });

    const dataRegistry = createPlatformRegistry({ scope: "data-unit" });
    registerDataStructurePlatformServices(dataRegistry);
    expect(dataRegistry.get("data-structure.provider").metadata.capabilityIds).toEqual(["checkpoint-tree"]);
    expect(typeof dataRegistry.get("data-structure.checkpointTree").value.startCheckpointTree).toBe("function");
    expect(dataRegistry.get("data-structure.merkleState").value).toBeNull();

    const moduleRegistry = createPlatformRegistry({ scope: "module-unit" });
    registerModuleManagementPlatformServices(moduleRegistry, {
      runtime: {
        mounts: {
          alpha: { id: "mount-alpha", kind: "search", enabled: false, reason: "disabled" },
          beta: {}
        }
      },
      runtimeOptions: { profile: "unit-profile" }
    });
    expect(moduleRegistry.get("module-management.mounts").value).toEqual([
      {
        name: "alpha",
        id: "mount-alpha",
        kind: "search",
        enabled: false,
        reason: "disabled"
      },
      {
        name: "beta",
        id: "",
        kind: "beta",
        enabled: true,
        reason: ""
      }
    ]);
    expect(moduleRegistry.get("module-management.provider").metadata).toMatchObject({
      profile: "unit-profile",
      mountNames: ["alpha", "beta"]
    });
  });

  it("executes noop example lifecycle scripts", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let output = "";
    try {
      await import("../../../server/platform/common/composition-management/examples/noop-service/doctor.mjs");
      await import("../../../server/platform/common/composition-management/examples/noop-service/prepare.mjs");
      await import("../../../server/platform/common/composition-management/examples/noop-service/smoke.mjs");
      await import("../../../server/platform/common/composition-management/examples/noop-service/stop.mjs");
      output = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    } finally {
      write.mockRestore();
    }

    expect(output).toContain('"step":"doctor"');
    expect(output).toContain('"step":"prepare"');
    expect(output).toContain('"step":"smoke"');
    expect(output).toContain('"step":"stop"');
  });
});
