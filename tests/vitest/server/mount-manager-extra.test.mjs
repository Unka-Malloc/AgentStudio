import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMountManager,
  normalizeRuntimeOptions
} from "../../../server/platform/common/module-manager/mount-manager.mjs";

const tempRoots = [];

afterEach(async () => {
  delete globalThis.__mountManagerTestState;
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-mount-manager-extra-"));
  tempRoots.push(root);
  return await testCase(root);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function writeInstrumentedMountModule(root, name) {
  const modulePath = path.join(root, `${name}.mjs`);
  await fs.writeFile(
    modulePath,
    [
      "const state = globalThis.__mountManagerTestState ??= {",
      "  created: [],",
      "  reloads: [],",
      "  closes: []",
      "};",
      "",
      "export function createMount({ mountName, runtimeOptions, userDataPath }) {",
      "  const instanceId = `${mountName}-${state.created.length + 1}`;",
      "  state.created.push({",
      "    instanceId,",
      "    mountName,",
      "    profile: runtimeOptions?.profile,",
      "    userDataPath",
      "  });",
      "",
      "  return {",
      "    id: instanceId,",
      "    kind: mountName,",
      "    enabled: true,",
      "    async reload(payload) {",
      "      state.reloads.push({ instanceId, payload });",
      "    },",
      "    async close() {",
      "      state.closes.push({ instanceId });",
      "    },",
      "    async extractDocument(input = {}) {",
      "      return {",
      "        parserId: instanceId,",
      "        text: `doc:${instanceId}` + (input?.suffix ? `:${input.suffix}` : \"\"),",
      "        metadata: { instanceId, mountName },",
      "        embeddedDocuments: []",
      "      };",
      "    },",
      "    async extractText(input = {}) {",
      "      return `text:${instanceId}` + (input?.suffix ? `:${input.suffix}` : \"\");",
      "    }",
      "  };",
      "}",
      "",
      "export default createMount;"
    ].join("\n"),
    "utf8"
  );
  return modulePath;
}

describe("mount-manager normalization and default routing", () => {
  it("normalizes runtime options, keeps default kind routes, and skips synthetic mountRouting keys", () => {
    const normalized = normalizeRuntimeOptions({
      profile: "anything-other-than-minimal",
      cwd: "/tmp/pact-unit",
      testHooks: { jobDelayMs: "15" },
      mountModules: {
        mountRouting: "ignored",
        customParser: " ./mounts/custom-parser.mjs "
      },
      mountRouting: {
        kindRoutes: {
          text: { mountName: "customParser", action: " extractText " }
        },
        extensionRoutes: {
          ".TXT": { mountName: "customParser", action: " extractDocument " }
        },
        mediaTypeRoutes: {
          "APPLICATION/JSON": { mountName: "customParser" }
        }
      }
    });

    expect(normalized.profile).toBe("default");
    expect(normalized.cwd).toBe("/tmp/pact-unit");
    expect(normalized.testHooks).toEqual({ jobDelayMs: 15 });
    expect(normalized.mountModules).not.toHaveProperty("mountRouting");
    expect(normalized.mountModules.customParser).toBe("./mounts/custom-parser.mjs");
    expect(normalized.mountRouting.kindRoutes.text).toEqual({
      mountName: "customParser",
      action: "extractText"
    });
    expect(normalized.mountRouting.kindRoutes.pdf).toEqual({
      mountName: "pdfProcessor",
      action: "extractDocument"
    });
    expect(normalized.mountRouting.extensionRoutes[".txt"]).toEqual({
      mountName: "customParser",
      action: "extractDocument"
    });
    expect(normalized.mountRouting.mediaTypeRoutes["application/json"]).toEqual({
      mountName: "customParser",
      action: "extractDocument"
    });
  });

  it("starts in the minimal profile with disabled no-op core mounts and the default document route", async () => {
    await withTempRoot(async (userDataPath) => {
      const manager = await createMountManager({
        userDataPath,
        runtimeOptions: {
          profile: "minimal"
        }
      });

      try {
        expect(manager.generation).toBe(1);
        expect(manager.mounts.documentParser).toMatchObject({
          kind: "documentParser",
          enabled: false,
          reason: "minimal-profile"
        });

        const noopDocument = await manager.mounts.documentParser.extractDocument({
          suffix: "sample"
        });

        expect(noopDocument).toEqual({
          parserId: "core/noop/documentParser",
          text: "",
          metadata: {},
          embeddedDocuments: []
        });

        expect(manager.createExecutionView().resolveDocumentRoute({})).toEqual({
          mountName: "documentParser",
          action: "extractDocument",
          matchedBy: "default"
        });
        expect(manager.createExecutionView().resolveDocumentRoute({ sourceKind: "text" })).toEqual({
          mountName: "documentParser",
          action: "extractDocument",
          matchedBy: "kind"
        });
      } finally {
        await manager.close();
      }
    });
  });
});

describe("mount-manager lifecycle and route validation", () => {
  it("merges persisted and runtime mount config, resolves routes, and reloads/closes mounts", async () => {
    await withTempRoot(async (root) => {
      const userDataPath = path.join(root, "user-data");
      const persistedMountModule = await writeInstrumentedMountModule(root, "persisted-mount");
      const runtimeMountModule = await writeInstrumentedMountModule(root, "runtime-mount");

      await fs.mkdir(userDataPath, { recursive: true });
      await writeJson(path.join(userDataPath, "mount-modules.json"), {
        customParser: persistedMountModule
      });
      await writeJson(path.join(userDataPath, "mount-routing.json"), {
        kindRoutes: {
          text: {
            mountName: "customParser",
            action: "extractDocument"
          }
        },
        extensionRoutes: {
          ".legacy": {
            mountName: "customParser",
            action: "extractText"
          }
        }
      });

      const manager = await createMountManager({
        userDataPath,
        runtimeOptions: {
          profile: "minimal",
          mountModules: {
            customParser: runtimeMountModule
          },
          mountRouting: {
            kindRoutes: {
              text: {
                mountName: "customParser",
                action: "extractText"
              }
            },
            extensionRoutes: {
              ".live": {
                mountName: "customParser",
                action: "extractDocument"
              }
            },
            mediaTypeRoutes: {
              "application/x-runtime": {
                mountName: "customParser",
                action: "extractText"
              }
            }
          }
        }
      });

      try {
        const state = globalThis.__mountManagerTestState;
        const firstMount = manager.mounts.customParser;

        expect(manager.generation).toBe(1);
        expect(firstMount).toBeTruthy();
        expect(manager.runtimeOptions.mountModules.customParser).toBe(runtimeMountModule);
        expect(manager.runtimeOptions.mountRouting.kindRoutes.text).toEqual({
          mountName: "customParser",
          action: "extractText"
        });
        expect(manager.runtimeOptions.mountRouting.extensionRoutes[".legacy"]).toEqual({
          mountName: "customParser",
          action: "extractText"
        });
        expect(manager.runtimeOptions.mountRouting.extensionRoutes[".live"]).toEqual({
          mountName: "customParser",
          action: "extractDocument"
        });
        expect(manager.runtimeOptions.mountRouting.mediaTypeRoutes["application/x-runtime"]).toEqual({
          mountName: "customParser",
          action: "extractText"
        });
        expect(state.created).toHaveLength(1);
        expect(state.reloads).toHaveLength(1);
        expect(state.reloads[0].payload).toMatchObject({
          mountName: "customParser",
          runtimeOptions: expect.objectContaining({
            profile: "minimal"
          })
        });

        expect(manager.createExecutionView().resolveDocumentRoute({
          sourceKind: "text",
          extension: ".legacy"
        })).toEqual({
          mountName: "customParser",
          action: "extractText",
          matchedBy: "extension"
        });
        expect(manager.createExecutionView().resolveDocumentRoute({
          sourceKind: "text",
          extension: ".live"
        })).toEqual({
          mountName: "customParser",
          action: "extractDocument",
          matchedBy: "extension"
        });
        expect(manager.createExecutionView().resolveDocumentRoute({
          sourceKind: "text"
        })).toEqual({
          mountName: "customParser",
          action: "extractText",
          matchedBy: "kind"
        });

        await manager.refreshMounts({
          settings: {
            refreshToken: "refresh"
          }
        });

        expect(manager.mounts.customParser).toBe(firstMount);
        expect(state.reloads).toHaveLength(2);
        expect(state.reloads[1].payload).toMatchObject({
          mountName: "customParser",
          settings: {
            refreshToken: "refresh"
          }
        });

        await manager.reloadMounts({
          settings: {
            reloadToken: "reload"
          }
        });

        const reloadedMount = manager.mounts.customParser;
        expect(reloadedMount).not.toBe(firstMount);
        expect(state.created).toHaveLength(2);
        expect(state.reloads).toHaveLength(3);
        expect(state.closes).toEqual([{ instanceId: firstMount.id }]);
        expect(state.reloads[2].payload).toMatchObject({
          mountName: "customParser",
          settings: {
            reloadToken: "reload"
          }
        });

        await manager.close();

        expect(manager.mounts).toEqual({});
        expect(state.closes).toEqual([
          { instanceId: firstMount.id },
          { instanceId: reloadedMount.id }
        ]);
      } finally {
        await manager.close().catch(() => {});
      }
    });
  });

  it("rejects routes whose loaded mount does not implement the requested action", async () => {
    await withTempRoot(async (root) => {
      const userDataPath = path.join(root, "user-data");
      const mountModule = await writeInstrumentedMountModule(root, "invalid-route-mount");

      await expect(createMountManager({
        userDataPath,
        runtimeOptions: {
          profile: "minimal",
          mountModules: {
            customParser: mountModule
          },
          mountRouting: {
            kindRoutes: {
              text: {
                mountName: "customParser",
                action: "parse"
              }
            }
          }
        }
      })).rejects.toThrow("不支持 parse");
    });
  });
});
