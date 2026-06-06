import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMountManager } from "../../../server/platform/common/module-manager/mount-manager.mjs";

const tempRoots = [];

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-mount-manager-final-extra-"));
  tempRoots.push(root);
  return testCase(root);
}

afterEach(async () => {
  delete globalThis.__objectMountFinalExtra;
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function writeObjectMountModule(root) {
  const modulePath = path.join(root, "object-mount.mjs");
  await fs.writeFile(
    modulePath,
    [
      "const state = globalThis.__objectMountFinalExtra ??= { closed: 0, completed: [] };",
      "export const id = 'object-module-mount';",
      "export const enabled = true;",
      "export function supports(input = {}) {",
      "  return input.mediaTypeHint === 'application/object';",
      "}",
      "export async function extractText(input = {}) {",
      "  return `object:${input.value || ''}`;",
      "}",
      "export async function onBatchCompleted(input = {}) {",
      "  state.completed.push(input.batchId || 'missing');",
      "}",
      "export async function close() {",
      "  state.closed += 1;",
      "}"
    ].join("\n"),
    "utf8"
  );
  return modulePath;
}

describe("mount-manager final extra coverage", () => {
  it("filters default routes whose feature runtime is inactive", async () => {
    await withTempRoot(async (userDataPath) => {
      const manager = await createMountManager({
        userDataPath,
        runtimeOptions: {
          profile: "minimal",
          featureRuntime: {
            activeFeatureIds: ["document-parser"]
          }
        }
      });

      try {
        expect(manager.mounts.pdfProcessor).toBeUndefined();
        expect(manager.mounts.documentParser).toMatchObject({
          kind: "documentParser",
          enabled: false,
          reason: "minimal-profile"
        });
        expect(manager.runtimeOptions.mountRouting.kindRoutes.pdf).toBeUndefined();
        expect(manager.createExecutionView().resolveDocumentRoute({
          sourceKind: "pdf",
          extension: ".unknown"
        })).toEqual({
          mountName: "documentParser",
          action: "extractDocument",
          matchedBy: "default"
        });
      } finally {
        await manager.close();
      }
    });
  });

  it("loads an object module directly and exposes its post-commit hook", async () => {
    await withTempRoot(async (root) => {
      const userDataPath = path.join(root, "user-data");
      const modulePath = await writeObjectMountModule(root);
      const manager = await createMountManager({
        userDataPath,
        runtimeOptions: {
          profile: "minimal",
          mountModules: {
            objectMount: modulePath
          },
          mountRouting: {
            mediaTypeRoutes: {
              "application/object": {
                mountName: "objectMount",
                action: "extractText"
              }
            }
          }
        }
      });

      try {
        expect(manager.mounts.objectMount).toMatchObject({
          id: "object-module-mount",
          kind: "objectMount",
          enabled: true
        });
        expect(await manager.mounts.objectMount.extractText({ value: "payload" })).toBe("object:payload");
        expect(manager.createExecutionView().resolveDocumentRoute({
          mediaTypeHint: "application/object"
        })).toEqual({
          mountName: "objectMount",
          action: "extractText",
          matchedBy: "mediaType"
        });

        const hooks = manager.createExecutionView().postCommitHooks;
        expect(hooks.map((hook) => hook.name)).toContain("objectMount");
        await hooks.find((hook) => hook.name === "objectMount").execute({ batchId: "batch-1" });
        expect(globalThis.__objectMountFinalExtra.completed).toEqual(["batch-1"]);
      } finally {
        await manager.close();
      }

      expect(globalThis.__objectMountFinalExtra.closed).toBe(1);
    });
  });
});
