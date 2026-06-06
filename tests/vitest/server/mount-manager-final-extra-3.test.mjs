import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/platform/modules/knowledge/file-processor/FileNormalizer/OCR/paddle-ocr.mjs", () => ({
  extractTextWithPaddleOcr: vi.fn(async (input = {}) => {
    globalThis.__mountManagerBuiltinState.ocrInputs.push(input);
    return `ocr:${input.value || ""}`;
  })
}));

vi.mock("../../../server/platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs", () => ({
  isTikaBackedDocument: vi.fn(({ extension = "", mediaTypeHint = "" } = {}) => (
    extension === ".docx" || mediaTypeHint === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )),
  extractDocumentWithTika: vi.fn(async (input = {}) => ({
    parserId: "mock-tika",
    text: `doc:${input.value || ""}`,
    metadata: { mocked: true },
    embeddedDocuments: []
  })),
  extractTextWithTika: vi.fn(async (input = {}) => `text:${input.value || ""}`)
}));

vi.mock("../../../server/platform/modules/knowledge/file-processor/FileNormalizer/PDFProcessor/index.mjs", () => ({
  createPdfProcessorMount: vi.fn(() => ({
    id: "mock-pdf",
    kind: "pdfProcessor",
    enabled: true,
    extractDocument: vi.fn(async () => ({
      parserId: "mock-pdf",
      text: "pdf",
      metadata: {},
      embeddedDocuments: []
    })),
    close: vi.fn()
  }))
}));

const {
  createMountManager,
  normalizeRuntimeOptions
} = await import("../../../server/platform/common/module-manager/mount-manager.mjs");

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  delete globalThis.__mountManagerBuiltinState;
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("mount-manager builtins final extra coverage", () => {
  it("instantiates default builtin and noop batch mounts without real external runtimes", async () => {
    globalThis.__mountManagerBuiltinState = { ocrInputs: [] };
    const userDataPath = await tempDir("pact-mount-builtins-");
    const manager = await createMountManager({
      userDataPath,
      runtimeOptions: {
        profile: "default"
      }
    });

    try {
      expect(manager.mounts.analysis).toMatchObject({
        id: "core/noop/analysis",
        kind: "analysis",
        enabled: false
      });
      expect(manager.mounts.vectorStore).toMatchObject({
        id: "core/noop/vectorStore",
        kind: "vectorStore"
      });
      expect(manager.mounts.graphStore).toMatchObject({
        id: "core/noop/graphStore",
        kind: "graphStore"
      });
      expect(manager.mounts.knowledgeBase).toMatchObject({
        id: "core/noop/knowledgeBase",
        kind: "knowledgeBase"
      });
      expect(manager.mounts.multimodalParser.supports()).toBe(false);
      expect(await manager.mounts.multimodalParser.extractText()).toBe("");

      await expect(manager.mounts.ocr.extractText({ value: "image" })).resolves.toBe("ocr:image");
      expect(globalThis.__mountManagerBuiltinState.ocrInputs).toEqual([{ value: "image" }]);

      expect(manager.mounts.documentParser.supports({ extension: ".docx" })).toBe(true);
      await expect(manager.mounts.documentParser.extractDocument({ value: "doc" }))
        .resolves.toMatchObject({ parserId: "mock-tika", text: "doc:doc" });
      await expect(manager.mounts.documentParser.extractText({ value: "doc" }))
        .resolves.toBe("text:doc");

      await expect(manager.mounts.pdfProcessor.extractDocument()).resolves.toMatchObject({
        parserId: "mock-pdf",
        text: "pdf"
      });
    } finally {
      await manager.close();
    }
  });

  it("creates dynamic noop mounts for routed names and preserves empty route targets", async () => {
    const userDataPath = await tempDir("pact-mount-dynamic-noop-");
    const manager = await createMountManager({
      userDataPath,
      runtimeOptions: {
        profile: "minimal",
        mountRouting: {
          extensionRoutes: {
            ".custom": {
              mountName: "customDynamic",
              action: "extractDocument"
            },
            ".ignored": {
              mountName: "",
              action: "extractText"
            }
          }
        }
      }
    });

    try {
      expect(manager.mounts.customDynamic).toMatchObject({
        id: "core/noop/customDynamic",
        kind: "customDynamic",
        enabled: false,
        reason: "minimal-profile"
      });
      await expect(manager.mounts.customDynamic.extractDocument()).resolves.toMatchObject({
        parserId: "core/noop/customDynamic",
        text: ""
      });
      expect(manager.runtimeOptions.mountRouting.extensionRoutes[".ignored"]).toEqual({
        mountName: "",
        action: "extractText"
      });
      expect(manager.createExecutionView().resolveDocumentRoute({ extension: ".custom" })).toEqual({
        mountName: "customDynamic",
        action: "extractDocument",
        matchedBy: "extension"
      });
    } finally {
      await manager.close();
    }
  });

  it("applies runtime mount config through the public manager API", async () => {
    const userDataPath = await tempDir("pact-mount-apply-config-");
    const manager = await createMountManager({
      userDataPath,
      runtimeOptions: {
        profile: "minimal"
      }
    });

    try {
      const beforeGeneration = manager.generation;
      const view = await manager.applyMountConfig({
        mountModules: {
          customRuntime: ""
        },
        mountRouting: {
          mediaTypeRoutes: {
            "application/custom": {
              mountName: "customRuntime",
              action: "extractText"
            }
          }
        }
      }, {
        settings: { source: "unit" }
      });

      expect(manager.generation).toBeGreaterThan(beforeGeneration);
      expect(view.mounts.customRuntime).toMatchObject({
        id: "core/noop/customRuntime",
        kind: "customRuntime"
      });
      expect(normalizeRuntimeOptions({ testHooks: null }).testHooks).toEqual({});
    } finally {
      await manager.close();
    }
  });
});
