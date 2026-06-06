import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnState = vi.hoisted(() => {
  function createEmitter() {
    const listeners = new Map();

    const removeListener = (event, entry) => {
      const current = listeners.get(event);
      if (!current) {
        return;
      }
      const next = current.filter((item) => item !== entry);
      if (next.length === 0) {
        listeners.delete(event);
      } else {
        listeners.set(event, next);
      }
    };

    const api = {
      on(event, handler) {
        const entry = { handler, once: false };
        const current = listeners.get(event) || [];
        current.push(entry);
        listeners.set(event, current);
        return api;
      },
      once(event, handler) {
        const entry = { handler, once: true };
        const current = listeners.get(event) || [];
        current.push(entry);
        listeners.set(event, current);
        return api;
      },
      emit(event, ...args) {
        const current = listeners.get(event);
        if (!current || current.length === 0) {
          return false;
        }

        for (const entry of [...current]) {
          entry.handler(...args);
          if (entry.once) {
            removeListener(event, entry);
          }
        }
        return true;
      }
    };

    return api;
  }

  return {
    calls: [],
    scenarios: [],
    createEmitter
  };
});

const spawnMock = vi.hoisted(() => vi.fn((command, args, options) => {
  const scenario = spawnState.scenarios.shift() || {};
  const child = spawnState.createEmitter();
  child.stdout = spawnState.createEmitter();
  child.stderr = spawnState.createEmitter();
  child.exitCode = scenario.exitCodeInitial ?? (scenario.noClose ? null : 0);
  child.kill = vi.fn(() => true);

  spawnState.calls.push({ command, args, options, child, scenario });

  const stdoutChunks = scenario.stdoutChunks || (scenario.stdout !== undefined ? [scenario.stdout] : []);
  const stderrChunks = scenario.stderrChunks || (scenario.stderr !== undefined ? [scenario.stderr] : []);
  const emitOutput = scenario.emitOutput !== false;
  const closeCode = scenario.closeCode ?? 0;

  const flushStreams = () => {
    if (emitOutput) {
      for (const chunk of stdoutChunks) {
        child.stdout.emit("data", Buffer.from(String(chunk)));
      }
      child.stdout.emit("end");

      for (const chunk of stderrChunks) {
        child.stderr.emit("data", Buffer.from(String(chunk)));
      }
      child.stderr.emit("end");
    }

    if (scenario.noClose) {
      return;
    }

    if (scenario.exitCodeInitial === null) {
      setImmediate(() => {
        child.exitCode = closeCode;
        child.emit("close", closeCode);
      });
      return;
    }

    child.exitCode = closeCode;
    child.emit("close", closeCode);
  };

  if (scenario.error) {
    setImmediate(() => {
      child.emit("error", scenario.error);
    });
    return child;
  }

  setImmediate(flushStreams);
  return child;
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import { extractDocumentWithTika, extractTextWithTika, isTikaBackedDocument, TIKA_IMPORT_EXTENSIONS, TIKA_VERSION } from "../../../server/platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs";
import { extractPdfVisualElements } from "../../../server/platform/modules/knowledge/file-processor/FileNormalizer/PDFProcessor/pdf-visual.mjs";
import { createPdfProcessorMount } from "../../../server/platform/modules/knowledge/file-processor/FileNormalizer/PDFProcessor/index.mjs";
import { extractTextWithPaddleOcr } from "../../../server/platform/modules/knowledge/file-processor/FileNormalizer/OCR/paddle-ocr.mjs";

let tempRoots = [];

async function withTempRoot(testFn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-file-normalizer-adapters-extra-"));
  tempRoots.push(root);
  try {
    return await testFn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function withRuntimeOverrides({ cwd, resourcesPath, env = {} } = {}, testFn) {
  const previousEnv = new Map();
  for (const [key, value] of Object.entries(env)) {
    previousEnv.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const cwdSpy = cwd ? vi.spyOn(process, "cwd").mockReturnValue(cwd) : null;
  const hadResourcesPath = Object.prototype.hasOwnProperty.call(process, "resourcesPath");
  const previousResourcesPath = process.resourcesPath;
  if (resourcesPath !== undefined) {
    process.resourcesPath = resourcesPath;
  }

  try {
    return await testFn();
  } finally {
    cwdSpy?.mockRestore();
    if (resourcesPath !== undefined) {
      if (hadResourcesPath) {
        process.resourcesPath = previousResourcesPath;
      } else {
        delete process.resourcesPath;
      }
    }
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function allowOnlyPaths(paths) {
  const allowed = new Set(paths);
  return vi.spyOn(fs, "access").mockImplementation(async (targetPath) => {
    if (allowed.has(targetPath)) {
      return undefined;
    }
    const error = new Error(`ENOENT: ${targetPath}`);
    error.code = "ENOENT";
    throw error;
  });
}

function bundledScriptPath(root, relativePath) {
  return path.join(root, relativePath);
}

function resetSpawnState() {
  spawnState.calls.length = 0;
  spawnState.scenarios.length = 0;
  spawnMock.mockClear();
}

beforeEach(() => {
  resetSpawnState();
});

afterEach(async () => {
  resetSpawnState();
  vi.restoreAllMocks();
  delete process.resourcesPath;
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Tika adapter", () => {
  it("exposes the stable capability shape and Tika-backed detection", () => {
    expect(TIKA_VERSION).toBe("3.2.3");
    expect(Array.isArray(TIKA_IMPORT_EXTENSIONS)).toBe(true);
    expect(TIKA_IMPORT_EXTENSIONS.length).toBeGreaterThan(0);
    expect(isTikaBackedDocument({ extension: ".pdf" })).toBe(true);
    expect(isTikaBackedDocument({ mediaTypeHint: "application/pdf" })).toBe(true);
    expect(isTikaBackedDocument({ extension: ".md", mediaTypeHint: "text/markdown" })).toBe(false);
  });

  it("resolves explicit settings, writes temp files, normalizes structured output, and cleans up", async () => {
    await withTempRoot(async (root) => {
      const jarPath = path.join(root, "custom", "tika-app.jar");
      const javaPath = path.join(root, "custom", "java");
      const accessSpy = allowOnlyPaths([jarPath, javaPath]);
      const payload = [
        {
          "": "drop-me",
          "x-tika:content": ["  Root line  \r\nSecond line  ", "unused"],
          title: " root "
        },
        {
          content: " embedded line \r\n next ",
          section: "child"
        }
      ];
      spawnState.scenarios.push({
        exitCodeInitial: null,
        closeCode: 0,
        stdout: JSON.stringify(payload)
      });

      const result = await extractDocumentWithTika({
        buffer: Buffer.from("ignored-buffer"),
        filePath: "relative/report.pdf",
        fileName: "report.pdf",
        settings: {
          tikaJarPath: `  ${jarPath}  `,
          javaBinPath: ` ${javaPath} `
        },
        userDataPath: root
      });

      expect(accessSpy).toHaveBeenCalled();
      expect(spawnState.calls).toHaveLength(1);
      expect(spawnState.calls[0].command).toBe(javaPath);
      expect(spawnState.calls[0].args).toEqual(["-jar", jarPath, "-J", expect.stringContaining(path.join("tmp", "tika"))]);
      expect(spawnState.calls[0].options).toMatchObject({ windowsHide: true });

      expect(result).toMatchObject({
        parserId: "builtin/tika",
        metadata: {
          title: " root "
        },
        text: "Root line  \nSecond line"
      });
      expect(result.embeddedDocuments).toHaveLength(1);
      expect(result.embeddedDocuments[0]).toMatchObject({
        id: "embedded-1",
        metadata: {
          content: " embedded line \r\n next ",
          section: "child"
        },
        text: "embedded line \n next"
      });

      spawnState.scenarios.push({
        exitCodeInitial: null,
        closeCode: 0,
        stdout: JSON.stringify([
          {
            "x-tika:content": ["  Root line  \r\nSecond line  ", "unused"],
            title: " root "
          },
          {
            content: " embedded line \r\n next ",
            section: "child"
          }
        ])
      });
      const extractedText = await extractTextWithTika({
        buffer: Buffer.from("ignored-buffer"),
        filePath: "relative/report.pdf",
        fileName: "report.pdf",
        settings: {
          tikaJarPath: jarPath,
          javaBinPath: javaPath
        },
        userDataPath: root
      });
      expect(extractedText).toBe("Root line  \nSecond line");
      expect(spawnState.calls).toHaveLength(2);

      const tempArg = spawnState.calls[0].args[3];
      await expect(fs.access(tempArg)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("uses bundled jar discovery and maps spawn ENOENT to TIKA_UNAVAILABLE", async () => {
    await withTempRoot(async (root) => {
      const resourceRoot = path.join(root, "resources");
      const jarPath = path.join(resourceRoot, "server", "platform", "modules", "knowledge", "tika", "tika-app-3.2.3.jar");
      const accessSpy = allowOnlyPaths([jarPath]);
      await fs.mkdir(path.dirname(jarPath), { recursive: true });
      await fs.writeFile(jarPath, "jar");

      await withRuntimeOverrides({
        cwd: path.join(root, "cwd"),
        resourcesPath: resourceRoot,
        env: {
          PACT_TIKA_JAR_PATH: undefined,
          PACT_JAVA_BIN_PATH: undefined
        }
      }, async () => {
        spawnState.scenarios.push({
          error: Object.assign(new Error("spawn failed"), { code: "ENOENT" })
        });

        await expect(extractDocumentWithTika({
          buffer: Buffer.from("payload"),
          fileName: "example.pdf",
          userDataPath: root
        })).rejects.toMatchObject({
          code: "TIKA_UNAVAILABLE",
          message: "未找到可用的 Java 运行时。请在设置中填写 Java 路径，或把 JRE 17 放到 server/platform/modules/knowledge/runtime/jre/<platform-arch>/ 下。"
        });

        expect(accessSpy).toHaveBeenCalled();
        expect(spawnState.calls[0].command).toBe("java");
        expect(spawnState.calls[0].args).toEqual(["-jar", jarPath, "-J", expect.stringContaining(path.join("tmp", "tika"))]);
      });
    });
  });

  it("surfaces Tika runtime failures, invalid JSON, and the timeout branch", async () => {
    await withTempRoot(async (root) => {
      const jarPath = path.join(root, "custom", "tika-app.jar");
      const javaPath = path.join(root, "custom", "java");
      allowOnlyPaths([jarPath, javaPath]);
      await fs.mkdir(path.dirname(jarPath), { recursive: true });
      await fs.writeFile(jarPath, "jar");
      await fs.mkdir(path.dirname(javaPath), { recursive: true });
      await fs.writeFile(javaPath, "java");

      spawnState.scenarios.push({
        exitCodeInitial: 0,
        closeCode: 1,
        stdout: "{}",
        stderr: "Unable to locate a Java Runtime"
      });
      await expect(extractDocumentWithTika({
        buffer: Buffer.from("payload"),
        filePath: path.join(root, "absolute.pdf"),
        settings: { tikaJarPath: jarPath, javaBinPath: javaPath },
        userDataPath: root
      })).rejects.toMatchObject({
        code: "TIKA_UNAVAILABLE"
      });

      spawnState.scenarios.push({
        exitCodeInitial: 0,
        closeCode: 0,
        stdout: "not-json"
      });
      await expect(extractDocumentWithTika({
        buffer: Buffer.from("payload"),
        filePath: path.join(root, "absolute.pdf"),
        settings: { tikaJarPath: jarPath, javaBinPath: javaPath },
        userDataPath: root
      })).rejects.toMatchObject({
        code: "TIKA_FAILED"
      });

      vi.useFakeTimers();
      try {
        spawnState.scenarios.push({
          emitOutput: false,
          noClose: true
        });
        const timeoutPromise = extractTextWithTika({
          buffer: Buffer.from("payload"),
          filePath: path.join(root, "absolute.pdf"),
          settings: {
            tikaJarPath: jarPath,
            javaBinPath: javaPath,
            tikaTimeoutMs: 1
          },
          userDataPath: root
        });
        const timeoutExpectation = expect(timeoutPromise).rejects.toMatchObject({
          code: "TIKA_TIMEOUT"
        });
        await vi.advanceTimersByTimeAsync(1000);
        await timeoutExpectation;
      } finally {
        vi.useRealTimers();
      }

      expect(spawnState.calls.length).toBe(3);
      expect(spawnState.calls[1].args).toEqual(["-jar", jarPath, "-J", path.join(root, "absolute.pdf")]);
      expect(spawnState.calls[2].options).toMatchObject({ windowsHide: true });
      expect(spawnState.calls[2].child.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });
});

describe("PDF visual adapter", () => {
  it("normalizes explicit Python selection, absolute inputs, and image/table payloads", async () => {
    await withTempRoot(async (root) => {
      const pythonPath = path.join(root, "python", "bin", "python3");
      const scriptPath = bundledScriptPath(root, path.join("server", "platform", "modules", "knowledge", "pdf", "pdf_visual_extract.py"));
      allowOnlyPaths([pythonPath, scriptPath]);
      await fs.mkdir(path.dirname(pythonPath), { recursive: true });
      await fs.writeFile(pythonPath, "python");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(scriptPath, "script");

      const inputPath = path.join(root, "sample.pdf");
      await fs.writeFile(inputPath, "%PDF-1.7");

      await withRuntimeOverrides({ resourcesPath: root }, async () => {
        spawnState.scenarios.push({
          exitCodeInitial: null,
          closeCode: 0,
          stdout: [
            "prefix line",
            JSON.stringify({
              ok: true,
              pageCount: "2",
              text: " extracted text \n",
              pages: [{ page: 1 }],
              imageCount: 0,
              tableCount: 0,
              warnings: [" first warning ", ""],
              elements: [
                {
                  kind: "image",
                  sequence: 7,
                  page: "3",
                  index: "2",
                  title: " inline image ",
                  dataUrl: "data:image/png;base64,AA",
                  mediaType: "image/png",
                  byteSize: "42",
                  width: "640",
                  height: "480",
                  xref: "9",
                  bboxes: [[1, 2, 3, 4]]
                },
                {
                  kind: "table",
                  sequence: 8,
                  page: "4",
                  index: "1",
                  text: " table text ",
                  rows: [[" A ", 1], null],
                  rowCount: "5",
                  columnCount: "6"
                },
                {
                  kind: "ignored"
                }
              ]
            })
          ].join("\n")
        });

        const result = await extractPdfVisualElements({
          buffer: Buffer.from("unused"),
          filePath: inputPath,
          fileName: "sample.pdf",
          settings: {
            pdfVisualPythonPath: ` ${pythonPath} `
          },
          userDataPath: root
        });

        expect(spawnState.calls).toHaveLength(1);
        expect(spawnState.calls[0].command).toBe(pythonPath);
        expect(spawnState.calls[0].args).toEqual([expect.stringContaining("pdf_visual_extract.py"), "--input", inputPath]);
        expect(result).toMatchObject({
          parserId: "builtin/pdf-visual-extractor",
          pageCount: 2,
          text: "extracted text",
          pages: [{ page: 1 }],
          imageCount: 1,
          tableCount: 1,
          warnings: ["first warning"]
        });
        expect(result.visualElements).toHaveLength(2);
        expect(result.visualElements[0]).toMatchObject({
          kind: "image",
          sequence: 7,
          page: 3,
          index: 2,
          title: "inline image",
          fileName: "page-003-image-002.png",
          mediaType: "image/png",
          byteSize: 42,
          width: 640,
          height: 480,
          imageDataUrl: "data:image/png;base64,AA",
          bboxes: [[1, 2, 3, 4]],
          xref: 9
        });
        expect(result.visualElements[1]).toMatchObject({
          kind: "table",
          sequence: 8,
          page: 4,
          index: 1,
          title: "table 8",
          rows: [[" A ", "1"], []],
          rowCount: 5,
          columnCount: 6,
          markdown: "table text",
          text: "table text"
        });
      });
    });
  });

  it("falls back to OCR python discovery and maps unavailable / malformed outputs", async () => {
    await withTempRoot(async (root) => {
      const inputPath = path.join(root, "sample.pdf");
      await fs.writeFile(inputPath, "%PDF-1.7");
      const scriptPath = bundledScriptPath(root, path.join("server", "platform", "modules", "knowledge", "pdf", "pdf_visual_extract.py"));
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(scriptPath, "script");
      allowOnlyPaths([scriptPath]);

      await withRuntimeOverrides({ resourcesPath: root }, async () => {
        spawnState.scenarios.push({
          exitCodeInitial: 0,
          closeCode: 2,
          stdout: JSON.stringify({ ok: false, error: "script missing", details: "no runtime" })
        });
        await expect(extractPdfVisualElements({
          buffer: Buffer.from("payload"),
          filePath: inputPath,
          fileName: "sample.pdf",
          settings: {},
          userDataPath: root
        })).rejects.toMatchObject({
          code: "PDF_VISUAL_UNAVAILABLE",
          message: "script missing",
          details: "no runtime"
        });

        spawnState.scenarios.push({
          exitCodeInitial: 0,
          closeCode: 0,
          stdout: "not-json"
        });
        await expect(extractPdfVisualElements({
          buffer: Buffer.from("payload"),
          filePath: inputPath,
          fileName: "sample.pdf",
          settings: {},
          userDataPath: root
        })).rejects.toMatchObject({
          code: "PDF_VISUAL_FAILED",
          message: "PDF 视觉解析未返回可解析的 JSON 结果。"
        });

        spawnState.scenarios.push({
          error: Object.assign(new Error("spawn enoent"), { code: "ENOENT" })
        });
        await expect(extractPdfVisualElements({
          buffer: Buffer.from("payload"),
          filePath: inputPath,
          fileName: "sample.pdf",
          settings: {},
          userDataPath: root
        })).rejects.toMatchObject({
          code: "PDF_VISUAL_UNAVAILABLE"
        });
      });
    });
  });

  it("builds the PDF processor capability and merges Tika and visual outputs with downgrade warnings", async () => {
    await withTempRoot(async (root) => {
      const mount = createPdfProcessorMount();
      expect(mount).toMatchObject({
        id: "builtin/pdf-processor",
        kind: "pdfProcessor",
        enabled: true
      });
      expect(mount.supports({ extension: ".pdf" })).toBe(true);
      expect(mount.supports({ extension: ".txt", mediaTypeHint: "text/plain" })).toBe(false);
      await expect(mount.extractDocument({ extension: ".txt", mediaTypeHint: "text/plain" })).rejects.toThrow("PDFProcessor 未配置可用的 Tika 入口。");

      const tikaJarPath = path.join(root, "custom", "tika-app.jar");
      const tikaJavaPath = path.join(root, "custom", "java");
      const pdfPythonPath = path.join(root, "custom", "python3");
      const pdfScriptPath = bundledScriptPath(root, path.join("server", "platform", "modules", "knowledge", "pdf", "pdf_visual_extract.py"));
      allowOnlyPaths([tikaJarPath, tikaJavaPath, pdfPythonPath, pdfScriptPath]);
      await fs.mkdir(path.dirname(tikaJarPath), { recursive: true });
      await fs.writeFile(tikaJarPath, "jar");
      await fs.mkdir(path.dirname(tikaJavaPath), { recursive: true });
      await fs.writeFile(tikaJavaPath, "java");
      await fs.mkdir(path.dirname(pdfPythonPath), { recursive: true });
      await fs.writeFile(pdfPythonPath, "python");

      await fs.mkdir(path.dirname(pdfScriptPath), { recursive: true });
      await fs.writeFile(pdfScriptPath, "script");

      await withRuntimeOverrides({ resourcesPath: root }, async () => {
        spawnState.scenarios.push({
          exitCodeInitial: null,
          closeCode: 0,
          stdout: JSON.stringify([
            {
              "x-tika:content": "primary text",
              title: "doc"
            }
          ])
        });
        spawnState.scenarios.push({
          exitCodeInitial: null,
          closeCode: 0,
          stdout: JSON.stringify({
            ok: true,
            pageCount: 1,
            text: "visual text",
            elements: [{ kind: "table", text: "visual table", rows: [["cell"]] }]
          })
        });
        const success = await mount.extractDocument({
          buffer: Buffer.from("payload"),
          filePath: path.join(root, "absolute.pdf"),
          fileName: "absolute.pdf",
          extension: ".pdf",
          mediaTypeHint: "application/pdf",
          settings: {
            tikaJarPath: tikaJarPath,
            javaBinPath: tikaJavaPath,
            pdfVisualPythonPath: pdfPythonPath
          },
          userDataPath: root
        });
        expect(success).toMatchObject({
          parserId: "builtin/pdf-processor",
          text: "primary text",
          pipeline: ["pdfProcessor", "builtin/tika", "builtin/pdf-visual-extractor"],
          metadata: {
            "X-Pact:pdfVisualPageCount": 1,
            "X-Pact:pdfVisualImageCount": 0,
            "X-Pact:pdfVisualTableCount": 1
          }
        });
        expect(success.visualElements).toHaveLength(1);

        spawnState.scenarios.push({
          exitCodeInitial: 0,
          closeCode: 1,
          stdout: JSON.stringify([
            {
              "x-tika:content": "fallback text"
            }
          ]),
          stderr: "Unable to locate a Java Runtime"
        });
        spawnState.scenarios.push({
          exitCodeInitial: null,
          closeCode: 0,
          stdout: JSON.stringify({
            ok: true,
            pageCount: 1,
            text: "visual fallback",
            elements: []
          })
        });
        const downgraded = await mount.extractDocument({
          buffer: Buffer.from("payload"),
          filePath: path.join(root, "absolute.pdf"),
          fileName: "absolute.pdf",
          extension: ".pdf",
          mediaTypeHint: "application/pdf",
          settings: {
            tikaJarPath,
            javaBinPath: tikaJavaPath,
            pdfVisualPythonPath: pdfPythonPath
          },
          userDataPath: root
        });
        expect(downgraded.pipeline).toEqual([
          "pdfProcessor",
          "builtin/pdf-visual-text",
          "builtin/pdf-visual-extractor"
        ]);
        expect(downgraded.text).toBe("visual fallback");
        expect(downgraded.warnings).toEqual([
          expect.stringContaining("PDF Tika 文本解析失败")
        ]);
        expect(downgraded.metadata).toMatchObject({
          "X-Pact:pdfVisualPageCount": 1,
          "X-Pact:pdfVisualImageCount": 0,
          "X-Pact:pdfVisualTableCount": 0
        });
      });
    });
  });
});

describe("OCR adapter", () => {
  it("rejects unsupported file types and parses image OCR results with explicit Python selection", async () => {
    await withTempRoot(async (root) => {
      const pythonPath = path.join(root, "custom", "python3");
      const scriptPath = bundledScriptPath(root, path.join("server", "platform", "modules", "knowledge", "ocr", "paddle_ocr_extract.py"));
      allowOnlyPaths([pythonPath, scriptPath]);
      await fs.mkdir(path.dirname(pythonPath), { recursive: true });
      await fs.writeFile(pythonPath, "python");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(scriptPath, "script");

      await expect(extractTextWithPaddleOcr({
        buffer: Buffer.from("payload"),
        fileType: "text",
        userDataPath: root
      })).rejects.toMatchObject({
        code: "OCR_FAILED",
        message: "不支持的 OCR 文件类型：text"
      });

      await withRuntimeOverrides({ resourcesPath: root }, async () => {
        spawnState.scenarios.push({
          exitCodeInitial: null,
          closeCode: 0,
          stdout: [
            "log line",
            JSON.stringify({
              text: "  OCR text  ",
              pages: [{ page: 1 }],
              inputPath: path.join(root, "absolute.png")
            })
          ].join("\n")
        });
        const result = await extractTextWithPaddleOcr({
          buffer: Buffer.from("payload"),
          filePath: "relative/image.png",
          fileName: "image.png",
          fileType: "image",
          settings: {
            ocrPythonPath: ` ${pythonPath} `,
            ocrLanguage: " en "
          },
          userDataPath: root
        });

        expect(spawnState.calls).toHaveLength(1);
        expect(spawnState.calls[0].command).toBe(pythonPath);
        expect(spawnState.calls[0].args).toEqual([
          expect.stringContaining("paddle_ocr_extract.py"),
          "--input",
          expect.stringContaining(path.join("tmp", "ocr")),
          "--file-type",
          "image",
          "--lang",
          "en"
        ]);
        expect(spawnState.calls[0].options).toMatchObject({
          env: {
            PACT_PADDLEOCR_LANG: "en"
          }
        });
        expect(result).toMatchObject({
          text: "OCR text",
          pages: [{ page: 1 }]
        });
        expect(result.inputPath).toBe(path.join(root, "absolute.png"));
      });
    });
  });

  it("falls back to bundled python discovery and maps spawn failures and malformed JSON", async () => {
    await withTempRoot(async (root) => {
      const runtimeRoot = path.join(root, "resources");
      const pythonPath = path.join(runtimeRoot, "server", "platform", "modules", "knowledge", "ocr", "runtime", `${process.platform}-${process.arch}`, "python3");
      await fs.mkdir(path.dirname(pythonPath), { recursive: true });
      await fs.writeFile(pythonPath, "python");
      const scriptPath = bundledScriptPath(runtimeRoot, path.join("server", "platform", "modules", "knowledge", "ocr", "paddle_ocr_extract.py"));
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(scriptPath, "script");
      allowOnlyPaths([pythonPath, scriptPath]);

      await withRuntimeOverrides({
        cwd: path.join(root, "cwd"),
        resourcesPath: runtimeRoot
      }, async () => {
        spawnState.scenarios.push({
          exitCodeInitial: 0,
          closeCode: 2,
          stdout: JSON.stringify({ ok: false, error: "missing ocr runtime", details: "runtime unavailable" })
        });
        await expect(extractTextWithPaddleOcr({
          buffer: Buffer.from("payload"),
          filePath: path.join(root, "absolute.pdf"),
          fileName: "absolute.pdf",
          fileType: "pdf",
          userDataPath: root
        })).rejects.toMatchObject({
          code: "OCR_UNAVAILABLE",
          details: "runtime unavailable"
        });

        spawnState.scenarios.push({
          exitCodeInitial: 0,
          closeCode: 0,
          stdout: "not-json"
        });
        await expect(extractTextWithPaddleOcr({
          buffer: Buffer.from("payload"),
          filePath: path.join(root, "absolute.pdf"),
          fileName: "absolute.pdf",
          fileType: "pdf",
          userDataPath: root
        })).rejects.toMatchObject({
          code: "OCR_FAILED",
          message: "PaddleOCR 未返回可解析的 JSON 结果。"
        });

        spawnState.scenarios.push({
          error: Object.assign(new Error("spawn enoent"), { code: "ENOENT" })
        });
        await expect(extractTextWithPaddleOcr({
          buffer: Buffer.from("payload"),
          filePath: path.join(root, "absolute.pdf"),
          fileName: "absolute.pdf",
          fileType: "pdf",
          userDataPath: root
        })).rejects.toMatchObject({
          code: "OCR_UNAVAILABLE"
        });
      });
    });
  });
});
