// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { bridge } from "../../../server-web/lib/bridge";
import * as rendering from "../../../server-web/lib/rendering";
import * as evidenceRendering from "../../../server-web/composables/console-evidence-rendering";
import * as evidenceUtils from "../../../server-web/composables/console-evidence-utils";
import {
  modelLibraryProviderDefinitions,
  moduleGroupDefinitions,
  emptySettings,
} from "../../../server-web/composables/console-defaults";
import * as modelUtils from "../../../server-web/composables/console-model-utils";
import {
  childSummary,
  canTrigger,
  dependencyDownloadPayload,
  isRuntimeDependencyRunActive,
  normalizeRuntimeDependencies,
  runtimeConfigurationGroups,
  runtimeDependencyLogEntries,
  runtimeDependencyLogText,
  runtimeDependencyRunProgressState,
  runtimeVersionHint,
  sourceHint,
  sourceParts,
  statusLabel,
  statusTone,
  listRuntimeDependencies,
  saveRuntimeDependencyConfiguration,
  downloadRuntimeDependency,
} from "../../../server-web/lib/runtime-dependencies";
import {
  parseHeaderParams,
  parseEmailHeaders,
  decodeMimeBody,
  decodeMimeWords,
  decodeQuotedPrintableToBytes,
  splitMimeParts,
  extractEmailRenderablePart,
  sanitizeHtmlContent,
  markdownToSafeHtml,
} from "../../../server-web/lib/rendering";
import * as runtimeClient from "../../../server-web/lib/runtime-dependencies-client";
import * as uploadFileList from "../../../server-web/lib/upload-file-list";
import {
  createKnowledgeUploadedFilesPayload,
  createKnowledgeUploadSession,
  knowledgeUploadFileKey,
  knowledgeUploadFileRelativePath,
  knowledgeUploadFingerprint,
} from "../../../server-web/lib/knowledge-upload-session";

const parseDocumentMock = vi.fn();
const createUploadSessionMock = vi.fn();
const uploadSessionChunkMock = vi.fn();

vi.mock("../../../server-web/lib/knowledge-documents-client", () => ({
  parseDocument: (...args: unknown[]) => parseDocumentMock(...args),
  getNormalizedDocuments: vi.fn(),
  knowledgeDocxExportUrl: vi.fn(),
  knowledgeHtmlExportUrl: vi.fn(),
  knowledgeMarkdownExportUrl: vi.fn(),
  normalizedDocumentUrl: vi.fn(),
}));

vi.mock("../../../server-web/lib/upload-session-client", () => ({
  createUploadSession: (...args: unknown[]) => createUploadSessionMock(...args),
  uploadSessionChunk: (...args: unknown[]) => uploadSessionChunkMock(...args),
  getUploadSession: vi.fn(),
}));

const runtimeDependencyFixture = (overrides: any = {}) => ({
  id: "language-runtimes",
  label: "Language Runtime",
  status: "unknown",
  detection: {},
  ...overrides,
});

function bytesToHex(bytes: number[]) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function makeMockFile(
  name: string,
  content: string,
  options: {
    type?: string;
    webkitRelativePath?: string;
    lastModified?: number;
  } = {},
) {
  const file = new File([content], name, {
    type: options.type || "text/plain",
    lastModified: options.lastModified || 0,
  }) as File & {
    webkitRelativePath?: string;
  };
  if (options.webkitRelativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      value: options.webkitRelativePath,
      writable: true,
      configurable: true,
    });
  }
  return file;
}

const fileReaderFixtures = new Map<string, string>();

const originalFileReader = globalThis.FileReader;
beforeEach(() => {
  fileReaderFixtures.clear();
  parseDocumentMock.mockReset();
  createUploadSessionMock.mockReset();
  uploadSessionChunkMock.mockReset();
  vi.restoreAllMocks();

  class MockFileReader {
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    result: string | ArrayBuffer | null = null;
    error: Error | null = null;

    readAsDataURL(file: { name?: string }) {
      this.result = `data:application/octet-stream;base64,${fileReaderFixtures.get(file.name || "") || ""}`;
      const event = {
        target: this,
      } as ProgressEvent<FileReader>;
      this.onload?.(event);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    readAsText() {
      return void 0;
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
});

afterEach(() => {
  globalThis.FileReader = originalFileReader;
});

describe("runtime-dependencies", () => {
  it("normalizes status labels and tones", () => {
    expect(statusLabel("running")).toBe("安装中");
    expect(statusLabel("present")).toBe("已存在");
    expect(statusLabel("missing")).toBe("missing");
    expect(statusLabel("")).toBe("未知");

    expect(statusTone("present")).toBe("success");
    expect(statusTone("running")).toBe("info");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("queued")).toBe("warning");
    expect(statusTone("unknown")).toBe("neutral");
  });

  it("summarizes child dependency status", () => {
    expect(childSummary({ id: "x", label: "X", status: "", children: [] } as any)).toBe("");
    expect(
      childSummary({
        id: "x",
        label: "X",
        status: "",
        children: [
          { id: "n", label: "Node", status: "installed" },
          { id: "p", label: "Python", status: "failed" },
        ] as any,
      } as any),
    ).toBe("Node: 安装成功 / Python: 不可用");
  });

  it("normalizes runtime dependency runtime groups", () => {
    const result = normalizeRuntimeDependencies([
      runtimeDependencyFixture({
        id: "language-runtimes",
        children: [
          {
            id: "node",
            label: "Node",
            status: "installed",
          },
          {
            id: "python",
            label: "",
            status: "running",
          } as any,
        ] as any,
      }),
      runtimeDependencyFixture({ id: "other", label: "Custom", status: "queued" }),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(
      expect.objectContaining({ id: "node", label: "Node.js 环境", status: "installed" }),
    );
    expect(result[1]).toEqual(expect.objectContaining({ id: "python", label: "Python 环境" }));
    expect(result[2]).toEqual(expect.objectContaining({ id: "other", label: "Custom" }));
  });

  it("computes version hints from availability and detection fields", () => {
    const configuredFile = {
      id: "java",
      label: "Java",
      status: "",
      configuration: [
        {
          title: "默认",
          entries: [
            { key: "jar_path", label: "Jar", value: "未配置" },
            { key: "java_version", label: "版本", value: " 17.0.11 " },
          ],
        },
      ],
      detection: {},
    } as any;
    expect(runtimeVersionHint(configuredFile)).toBe("17.0.11");

    expect(
      runtimeVersionHint(
        runtimeDependencyFixture({
          detection: {
            availabilityLabel: "检测到 /usr/bin/java",
          },
        }),
      ),
    ).toBe("检测到 /usr/bin/java");

    expect(
      runtimeVersionHint({
        ...runtimeDependencyFixture({ id: "python", label: "Python", status: "" }),
        detection: { javaVersion: "", pythonVersion: "3.11.9" },
      } as any),
    ).toBe("3.11.9");

    expect(
      runtimeVersionHint({
        ...runtimeDependencyFixture({ id: "python", status: "" }),
        configuration: [
          {
            title: "paths",
            entries: [{ key: "artifact.url", value: "https://example.local/tools/python-3.12.4.tar.gz" }],
          },
        ],
        detection: {},
        children: [],
      } as any),
    ).toBe("3.12.4");

    const parent = runtimeDependencyFixture({
      children: [
        {
          id: "node",
          label: "Node",
          status: "installed",
          children: [],
          detection: { version: "20.3.1" },
        },
        {
          id: "java",
          label: "Java",
          status: "installed",
          children: [],
          detection: { availabilityLabel: "未检测到" },
        },
      ],
    });
    expect(runtimeVersionHint(parent)).toBe("Node: 20.3.1");
  });

  it("builds source part hints through explicit, legacy, child and fallback paths", () => {
    const explicitFixture = runtimeDependencyFixture({
      detection: { source: { label: "平台", path: "/opt/runtime", detail: "v1" } },
    });
    const explicit = sourceParts(explicitFixture);
    expect(explicit).toEqual({
      detail: "v1",
      path: "/opt/runtime",
      source: "平台",
    });
    expect(sourceHint(explicitFixture)).toBe("平台：/opt/runtime；v1");

    const legacy = sourceParts(
      runtimeDependencyFixture({
        detection: {
          configured: true,
          configuredConnections: [1],
          configPath: "/server/platform/modules/java/config",
        },
      }),
    );
    expect(legacy.source).toBe("平台配置");

    const childSource = sourceParts(
      runtimeDependencyFixture({
        detection: {},
        children: [
          {
            id: "node",
            label: "Node",
            status: "present",
            detection: { source: { label: "A", path: "/Applications/Node/node" } },
          } as any,
        ],
      }),
    );
    expect(childSource.source).toBe("子依赖");
    expect(childSource.path).toContain("Node");

    const fallback = sourceParts(runtimeDependencyFixture());
    expect(fallback).toEqual({ detail: "", path: "未返回路径", source: "未返回来源" });
  });

  it("maps additional legacy source path heuristics", () => {
    const dockerPath = sourceParts(
      runtimeDependencyFixture({
        detection: { dockerPath: "/usr/bin/node", configured: true },
      }),
    );
    expect(dockerPath).toEqual({
      detail: "",
      path: "/usr/bin/node",
      source: "环境变量: PATH",
    });

    expect(
      sourceParts(
        runtimeDependencyFixture({
          detection: { configuredBinary: "/opt/bin/cli", configuredPresent: true },
        }),
      ),
    ).toEqual({
      detail: "",
      path: "/opt/bin/cli",
      source: "自定义配置",
    });

    expect(
      sourceParts(
        runtimeDependencyFixture({
          detection: { cachedExecutablePath: "/build/local-data/runtime", cachedPresent: true },
        }),
      ),
    ).toEqual({
      detail: "",
      path: "/build/local-data/runtime",
      source: "平台本地安装",
    });

    expect(
      sourceParts(runtimeDependencyFixture({ detection: { appPath: "/Applications/Tool.app", appPresent: true } })),
    ).toEqual({
      detail: "",
      path: "/Applications/Tool.app",
      source: "系统应用",
    });

    expect(
      sourceParts(runtimeDependencyFixture({ detection: { javaPath: "/server/platform/modules/java/bin/java" } })),
    ).toEqual({
      detail: "",
      path: "/server/platform/modules/java/bin/java",
      source: "平台本地运行时",
    });

    expect(
      sourceParts(runtimeDependencyFixture({ detection: { pythonPath: "/runtime-dependencies/python/bin/python" } })),
    ).toEqual({
      detail: "",
      path: "/runtime-dependencies/python/bin/python",
      source: "平台缓存",
    });

    expect(
      sourceParts(runtimeDependencyFixture({ detection: { icloudRoot: "/Users/me/Library/Mobile Documents/Pact" } })),
    ).toEqual({
      detail: "",
      path: "/Users/me/Library/Mobile Documents/Pact",
      source: "系统 iCloud",
    });

    expect(
      sourceParts(runtimeDependencyFixture({ detection: { cloudStorageRoot: "/Users/me/Library/CloudStorage/Drive" } })),
    ).toEqual({
      detail: "",
      path: "/Users/me/Library/CloudStorage/Drive",
      source: "系统云盘目录",
    });
  });

  it("builds runtime configuration groups from explicit configuration and detection fields", () => {
    expect(
      runtimeConfigurationGroups({
        ...runtimeDependencyFixture(),
        configuration: [
          {
            title: "",
            entries: [{ key: "x", label: "X", value: "1" }],
          },
          {
            title: "主配置",
            entries: [
              { key: "x", label: "X", value: "" },
              { key: "y", label: "Y", value: "2", configured: true },
            ],
          },
        ],
      } as any),
    ).toEqual([
      {
        title: "主配置",
        entries: [
          { key: "x", label: "X", value: "" },
          { key: "y", label: "Y", value: "2", configured: true },
        ],
      },
    ]);

    expect(
      runtimeConfigurationGroups({
        ...runtimeDependencyFixture(),
        configuration: [],
        detection: { source: "X", pythonVersion: "3.11" },
      } as any),
    ).toEqual([
      {
        kind: "detection",
        title: "检测字段",
        entries: [{ kind: "detection", key: "pythonVersion", label: "pythonVersion", value: "3.11", configured: true }],
      },
    ]);
  });

  it("computes dependency run helpers and download payloads", () => {
    expect(canTrigger(runtimeDependencyFixture({ status: "present", downloadable: false }))).toBe(false);
    expect(canTrigger(runtimeDependencyFixture({ status: "failed", downloadable: true }))).toBe(true);

    expect(dependencyDownloadPayload(runtimeDependencyFixture({ id: "custom" }))).toEqual({
      targetId: "custom",
      async: true,
    });

    expect(isRuntimeDependencyRunActive("running")).toBe(true);
    expect(isRuntimeDependencyRunActive("queued")).toBe(true);
    expect(isRuntimeDependencyRunActive("failed")).toBe(false);
  });

  it("parses dependency logs and progress states", () => {
    const [first, invalidDateEntry] = runtimeDependencyLogEntries([
        { at: "2026-06-04T00:00:00.000Z", level: "info", message: "  started  " },
        { at: "", level: "warn", message: "" },
        { at: "bad-date", level: "", message: "ok" },
    ]);
    expect(first).toMatchObject({
      key: "2026-06-04T00:00:00.000Z:info:0",
      time: new Date("2026-06-04T00:00:00.000Z").toLocaleTimeString("zh-CN", { hour12: false }),
      level: "info",
      message: "started",
      prefix: `${new Date("2026-06-04T00:00:00.000Z").toLocaleTimeString("zh-CN", { hour12: false })} info`,
    });
    expect(invalidDateEntry).toMatchObject({
      key: "bad-date:info:2",
      time: "Invalid Date",
      level: "info",
      message: "ok",
      prefix: "Invalid Date info",
    });

    expect(
      runtimeDependencyLogText([
        { at: "2026-06-04T00:00:00.000Z", level: "info", message: " ready " },
      ]),
    ).toContain("ready");

    expect(
      runtimeDependencyRunProgressState({
        runId: "1",
        targetId: "2",
        status: "running",
        steps: [
          { key: "a", label: "准备", status: "running" },
          { key: "b", label: "安装", status: "completed" },
          { key: "c", label: "检测", status: "failed" },
          { key: "d", label: "", status: "queued" },
        ],
        totalSteps: 6,
        completedSteps: 1,
      }),
    ).toEqual({
      completedSteps: 1,
      detail: "",
      label: "1/6",
      progressPercent: 17,
      segments: [
        { key: "a", label: "准备", state: "active" },
        { key: "b", label: "安装", state: "complete" },
        { key: "c", label: "检测", state: "failed" },
        { key: "d", label: "d", state: "pending" },
      ],
      totalSteps: 6,
    });

    expect(
      runtimeDependencyRunProgressState({
        runId: "fallback",
        targetId: "target",
        status: "running",
        steps: [
          { key: "done", status: "completed" },
          { key: "active", status: "active" },
        ],
      }),
    ).toMatchObject({
      completedSteps: 1,
      label: "1/2",
      progressPercent: 50,
      segments: [
        { key: "done", label: "done", state: "complete" },
        { key: "active", label: "active", state: "active" },
      ],
      totalSteps: 2,
    });

    expect(
      runtimeDependencyRunProgressState({
        runId: "1",
        targetId: "2",
        status: "running",
        steps: [],
        completedSteps: 0,
        progressPercent: 120,
      }),
    ).toMatchObject({
      progressPercent: 100,
      label: "",
    });
  });

  it("forwards runtime dependency client operations", async () => {
    const listSpy = vi.spyOn(runtimeClient, "listRuntimeDependencies");
    const downloadSpy = vi.spyOn(runtimeClient, "downloadRuntimeDependency");
    const saveSpy = vi.spyOn(runtimeClient, "saveRuntimeDependencyConfiguration");

    const listResponse = { ok: true, dependencies: [] as any[] };
    const actionResponse = { ok: true } as any;
    const saveResponse = { ok: true, updated: 1 } as any;

    listSpy.mockResolvedValue(listResponse);
    downloadSpy.mockResolvedValue(actionResponse);
    saveSpy.mockResolvedValue(saveResponse);

    await expect(listRuntimeDependencies()).resolves.toEqual(listResponse);
    await expect(downloadRuntimeDependency(runtimeDependencyFixture())).resolves.toEqual(actionResponse);
    await expect(saveRuntimeDependencyConfiguration("x", [{ key: "k", value: "v" }])).resolves.toEqual(saveResponse);

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "language-runtimes", async: true }),
    );
    expect(saveSpy).toHaveBeenCalledWith({ targetId: "x", entries: [{ key: "k", value: "v" }] });
  });
});

describe("bridge", () => {
  it("passes normalized parse payload fields to knowledge document parser", async () => {
    const parseResult = { ok: true, body: "ok" };
    parseDocumentMock.mockResolvedValue(parseResult as any);

    const payload = {
      pipelineId: "p1",
      chunking: "paragraph",
      contextBudget: "x",
      payloadBudget: "y",
      granularity: "fine",
      dynamicParsing: true,
      expectedOutputs: ["text"],
      inputText: "hello",
    };
    const raw = { ...payload };

    await expect(bridge.parseDocument(payload as any)).resolves.toEqual(parseResult);
    expect(payload).toEqual(raw);
    expect(parseDocumentMock).toHaveBeenCalledWith(payload);
  });

  it("does not mutate parse payload while delegating", async () => {
    parseDocumentMock.mockResolvedValue({ ok: true });
    const payload = {
      chunking: "segment",
      contextBudget: "1",
      payloadBudget: "2",
      granularity: "medium",
      dynamicParsing: false,
      expectedOutput: "text",
      inputText: "x",
    };
    await bridge.parseDocument(payload as any);

    expect(parseDocumentMock).toHaveBeenCalledWith(payload);
  });

  it("exposes browser bridge picker helpers as no-op defaults", async () => {
    await expect(bridge.pickFiles()).resolves.toEqual([]);
    await expect(bridge.pickFolders()).resolves.toEqual([]);
  });
});

describe("rendering helpers", () => {
  it("sanitizes html and links safely", () => {
    const template =
      '<div><a href="javascript:alert(1)" onclick="evil()">bad</a><a href="https://example.com">good</a>' +
      '<img src="data:image/png;base64,AA" onload="x()" />' +
      "<script>alert('x')</script>" +
      "</div>";

    const safe = rendering.sanitizeHtmlContent(template);
    expect(safe).not.toContain("script");
    expect(safe).not.toContain("onclick");
    expect(safe).not.toContain("javascript:alert(1)");
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain("target=\"_blank\"");
    expect(safe).toContain("data:image/png;base64,AA");
  });

  it("projects text formatting and evidence refs", () => {
    expect(rendering.escapeHtmlText('<x>"&"')).toBe("&lt;x&gt;&quot;&amp;&quot;");
    expect(rendering.safeLinkHref("mailto:admin@example.com")).toBe("mailto:admin@example.com");
    expect(rendering.safeMediaSrc("/assets/icon.png")).toBe("/assets/icon.png");
    expect(rendering.safeMediaSrc("ftp://example.com")).toBe("");

    expect(rendering.uniqueEvidenceRefs(["a", "a ", " a ", "", "b"])).toEqual(["a", "b"]);

    expect(rendering.extractEvidenceRefsFromText("use evidence::A-1 and source-evidence::B_2")).toEqual([
      "evidence::A-1",
      "source-evidence::B_2",
    ]);

    expect(rendering.evidenceRefHref("abc/1")).toBe("#pact-evidence-abc%2F1");
    expect(rendering.evidenceIdFromHref("#pact-evidence-abc%2F1")).toBe("abc/1");
    expect(rendering.evidenceIdFromHref("bad")).toBe("");

    const text = "source::x and [source::x](link)";
    expect(rendering.linkifyEvidenceRefsInMarkdown(text, ["source::x"])).toContain("[source::x](#pact-evidence-source%3A%3Ax)");
  });

  it("validates safe link/media handling and MIME header parsing", () => {
    expect(rendering.safeLinkHref("")).toBe("");
    expect(rendering.safeLinkHref("ftp://example.com")).toBe("");
    expect(rendering.safeMediaSrc("")).toBe("");
    expect(rendering.safeMediaSrc("blob:xyz")).toBe("blob:xyz");
    expect(rendering.safeMediaSrc("ftp://example.com")).toBe("");

    expect(rendering.decodeQuotedPrintableToBytes("hello_world", true)).toEqual([
      104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100,
    ]);
    expect(rendering.parseHeaderParams("text/html; charset=\"utf-8\"")).toEqual({
      type: "text/html",
      params: { charset: "utf-8" },
    });
    expect(parseHeaderParams("invalid")).toEqual({ type: "invalid", params: {} });
    expect(parseEmailHeaders("Hello World")).toEqual({ headers: [], body: "Hello World" });
    expect(extractEmailRenderablePart("Content-Type: text/plain\r\n\r\nhello").contentType).toBe("text/plain");
  });

  it("formats markdown/html through safe conversion", () => {
    const html = rendering.markdownToSafeHtml("[link](javascript:alert(1))<script>alert(1)</script>");
    expect(html).toContain("<p>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
  });

  it("parses headers and decodes MIME bodies", () => {
    const headersText = "From: Alice <a@x.com>\n" +
      "To: Bob <b@x.com>\n" +
      "Subject: Hello\r\n" +
      "Content-Type: text/plain; charset=UTF-8;\r\n" +
      "\tname=\"demo.txt\"\r\n" +
      "Content-Transfer-Encoding: quoted-printable\r\n" +
      "\r\n" +
      "a=b=0A c=20d";

    const headers = parseEmailHeaders(headersText);
    expect(headers.headers).toEqual([
      ["From", "Alice <a@x.com>"],
      ["To", "Bob <b@x.com>"],
      ["Subject", "Hello"],
      ["Content-Type", "text/plain; charset=UTF-8; name=\"demo.txt\""],
      ["Content-Transfer-Encoding", "quoted-printable"],
    ]);
    expect(headers.body).toBe("a=b=0A c=20d");

    expect(parseHeaderParams("text/html; charset=\"UTF-8\"; boundary=abc")).toEqual({
      type: "text/html",
      params: { charset: "UTF-8", boundary: "abc" },
    });

    expect(decodeQuotedPrintableToBytes("a=20b")).toEqual([97, 32, 98]);
    expect(decodeMimeBody("a=b=0A c=20d", headers.headers)).toBe("a=b\n c d");
    expect(decodeMimeBody("aGVsbG8=", [["Content-Transfer-Encoding", "base64"], ["Content-Type", "text/plain; charset=UTF-8"]])).toBe("hello");

    expect(decodeMimeWords("=?UTF-8?B?5rWL6K+V?=")).toContain("测试");
    expect(splitMimeParts("--boundary\r\nA--boundary--", "boundary")).toEqual(["A"]);

    const multipart =
      "Content-Type: multipart/alternative; boundary=alt\r\n\r\n" +
      "--alt\r\nContent-Type: text/html\r\n\r\n<html><body>html</body></html>\r\n--alt\r\nContent-Type: text/plain\r\n\r\nplain\r\n--alt--";
    expect(extractEmailRenderablePart(multipart).contentType).toBe("text/plain");

    expect(
      extractEmailRenderablePart("Content-Type: multipart/mixed; boundary=alt2\r\n\r\n--alt2\r\nplain text\r\n--alt2--").contentType,
    ).toBe("text/plain");
  });
});

describe("upload file list utils", () => {
  it("builds upload list entries for upload and download modes", () => {
    const uploadFile = makeMockFile("dir/a.txt", "hello", { webkitRelativePath: "dir/a.txt" });
    const downloadFile = {
      key: "k1",
      name: "result.txt",
      relativePath: "result.txt",
      size: 17,
      extension: "TXT",
      statusLabel: "完成",
      statusTone: "success",
      detail: "OK",
    } as any;

    expect(uploadFileList.buildUploadFileEntries({ files: [uploadFile], mode: "upload", resultFiles: [] })).toEqual([
      {
        key: "dir/a.txt:5:0:0",
        name: "a.txt",
        relativePath: "dir/a.txt",
        directory: "dir",
        extension: "TXT",
        size: 5,
      },
    ]);

    expect(uploadFileList.buildUploadFileEntries({ files: [], mode: "download", resultFiles: [downloadFile] })).toEqual([
      {
        key: "k1",
        name: "result.txt",
        relativePath: "result.txt",
        directory: "",
        extension: "TXT",
        size: 17,
        detail: "OK",
        href: undefined,
        actionLabel: undefined,
        downloadName: undefined,
        statusLabel: "完成",
        statusTone: "success",
      },
    ]);

    expect(
      uploadFileList.buildUploadFileEntries({
        files: [],
        mode: "download",
        resultFiles: [{ name: "readme", size: 1024 } as any],
      }),
    ).toEqual([
      {
        key: "readme:1024:0",
        name: "readme",
        relativePath: "readme",
        directory: "",
        extension: "FILE",
        size: 1024,
        detail: undefined,
        href: undefined,
        actionLabel: undefined,
        downloadName: undefined,
        statusLabel: undefined,
        statusTone: undefined,
      },
    ]);
  });

  it("summarizes selected files and resolves progress states", () => {
    const file1 = makeMockFile("a.txt", "1");
    const file2 = makeMockFile("b.txt", "2");

    expect(
      uploadFileList.summarizeUploadSelection({
        files: [file1, file2],
        fileEntries: [],
        mode: "upload",
        formatBytes: (bytes: number) => `${bytes}B`,
        summary: "",
      }),
    ).toBe("2 个文件 · 2B");

    expect(
      uploadFileList.summarizeUploadSelection({
        files: [],
        fileEntries: [],
        mode: "download",
        formatBytes: (bytes: number) => `${bytes}B`,
        summary: "",
      }),
    ).toBe("0 个文件");

    expect(
      uploadFileList.summarizeUploadSelection({
        files: [],
        fileEntries: [{ size: 32 }, { size: 24 }] as any,
        mode: "download",
        formatBytes: (bytes: number) => `${bytes}B`,
        summary: "",
      }),
    ).toBe("2 个文件 · 56B");

    expect(uploadFileList.summarizeUploadSelection({
      files: [file1],
      fileEntries: [],
      mode: "upload",
      formatBytes: () => "99B",
      summary: "已有摘要",
    })).toBe("已有摘要");

    expect(uploadFileList.uploadTotalProgressSteps).toBe(5);

    const formatFn = (status: string) => ({ completed: "done", failed: "fail", running: "running" }[status] || status);
    expect(
      uploadFileList.resolveUploadProgressState({
        files: [],
        ingestJob: null,
        ingestProgress: "",
        isBusy: false,
        jobStatusLabels: { completed: "done", failed: "fail", running: "running" },
        jobStatusTone: () => "primary",
      }),
    ).toEqual({
      completedSteps: 0,
      detail: "等待文件",
      label: "未选择",
      tone: "neutral",
    });

    expect(
      uploadFileList.resolveUploadProgressState({
        files: [file1],
        ingestJob: null,
        ingestProgress: "init",
        isBusy: false,
        jobStatusLabels: { completed: "done", failed: "fail", running: "running" },
        jobStatusTone: () => "primary",
      }),
    ).toMatchObject({
      completedSteps: 1,
      detail: "init",
      label: "待处理",
      tone: "neutral",
    });

    expect(
      uploadFileList.resolveUploadProgressState({
        files: [file1],
        ingestJob: { status: "running", progressPercent: 50, stage: "queue" } as any,
        ingestProgress: "run",
        isBusy: true,
        jobStatusLabels: { running: "进行中" },
        jobStatusTone: (value: string) => value,
      }),
    ).toMatchObject({
      completedSteps: 3,
      detail: "queue",
      tone: "running",
    });

    expect(
      uploadFileList.resolveUploadProgressState({
        files: [file1],
        ingestJob: { status: "failed", progressPercent: 120, error: "x", stage: "upload" } as any,
        ingestProgress: "upload",
        isBusy: false,
        jobStatusLabels: { failed: "失败" },
        jobStatusTone: (value: string) => value,
      }),
    ).toMatchObject({
      completedSteps: 4,
      detail: "x",
      label: "失败",
      tone: "failed",
    });

    expect(
      uploadFileList.resolveUploadProgressState({
        files: [file1],
        ingestJob: { status: "completed", stage: "ready" } as any,
        ingestProgress: "",
        isBusy: false,
        jobStatusLabels: { completed: "完成" },
        jobStatusTone: (value: string) => value,
      }),
    ).toEqual({
      completedSteps: uploadFileList.uploadTotalProgressSteps,
      detail: "ready",
      label: "完成",
      tone: "completed",
    });
  });
});

describe("knowledge-upload-session", () => {
  it("computes relative path, key and fingerprint", () => {
    const file = makeMockFile("a.txt", "abc", {
      webkitRelativePath: "x/y/a.txt",
      lastModified: 100,
    });
    expect(knowledgeUploadFileRelativePath(file)).toBe("x/y/a.txt");
    expect(knowledgeUploadFileKey(file)).toBe("x/y/a.txt:3:100");
    expect(knowledgeUploadFingerprint([file])).toBe(`${knowledgeUploadFileKey(file)}`);
  });

  it("builds payloads with progress and file hashes", async () => {
    fileReaderFixtures.set("a.txt", "YQ==");
    fileReaderFixtures.set("b.txt", "Yg==");

    const file1 = makeMockFile("a.txt", "a", { type: "text/plain", lastModified: 1, webkitRelativePath: "a.txt" });
    const file2 = makeMockFile("b.txt", "bb", { type: "text/plain", lastModified: 2, webkitRelativePath: "b.txt" });

    const digestValues = [
      [0x11, 0x22],
      [0x33, 0x44],
      [0x55, 0x66],
      [0x77, 0x88],
      [0x99, 0xaa],
    ];
    let digestCall = 0;
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async () => {
      const bytes = digestValues[Math.min(digestCall, digestValues.length - 1)] as number[];
      digestCall += 1;
      return new Uint8Array(bytes).buffer;
    });

    const onProgress = vi.fn();
    const result = await createKnowledgeUploadedFilesPayload([file1, file2], { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress.mock.calls[0]?.[0]).toMatchObject({
      stage: "digest",
      uploadedBytes: 0,
      totalBytes: 3,
      percent: 0,
      message: "准备预览输入 1/2",
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "a.txt",
      relativePath: "a.txt",
      mediaType: "text/plain",
      dataBase64: "YQ==",
      sha256: bytesToHex(digestValues[0]),
      byteSize: 1,
    });
    expect(result[1].sha256).toBe(bytesToHex(digestValues[1]));
  });

  it("rejects payload creation when file read fails", async () => {
    const originalReader = globalThis.FileReader;
    class FailingFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      result: string | ArrayBuffer | null = null;
      error: Error | null = null;

      readAsDataURL(file: { name?: string }) {
        this.error = new Error(`cannot read ${file.name || ""}`);
        const event = { target: this } as ProgressEvent<FileReader>;
        this.onerror?.(event);
      }

      readAsText() {
        return void 0;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.FileReader = FailingFileReader as any;
    await expect(createKnowledgeUploadedFilesPayload([makeMockFile("err.txt", "x")])).rejects.toThrow(
      "cannot read err.txt",
    );
    globalThis.FileReader = originalReader;
  });

  it("creates upload session and uploads chunks with resume offsets", async () => {
    fileReaderFixtures.set("a.txt", "YQ==");
    const file = makeMockFile("a.txt", "abcdefghij", {
      webkitRelativePath: "docs/a.txt",
      lastModified: 1,
      type: "text/plain",
    });

    const digestValues = [
      [0xaa, 0xbb],
      [0x11, 0x22],
      [0x33, 0x44],
    ];
    let digestCall = 0;
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async () => {
      const bytes = digestValues[Math.min(digestCall, digestValues.length - 1)] as number[];
      digestCall += 1;
      return new Uint8Array(bytes).buffer;
    });

    createUploadSessionMock.mockResolvedValue({
      sessionId: "session-1",
      files: [{ index: 0, fileIndex: 0, name: "docs/a.txt", byteSize: 10, receivedBytes: 3 }],
    } as any);
    uploadSessionChunkMock.mockResolvedValue({ sessionId: "session-1" } as any);

    const onProgress = vi.fn();
    const result = await createKnowledgeUploadSession([file], {
      checkpointPrefix: "unit-prefix",
      checkpointMode: "mode-a",
      checkpointSource: "ui",
      chunkSize: 4,
      onProgress,
    });

    expect(createUploadSessionMock).toHaveBeenCalledTimes(1);
    const [createUploadSessionPayload] = createUploadSessionMock.mock.calls;
    expect(createUploadSessionPayload?.[0]).toMatchObject({
      manifest: {
        manifestDigest: bytesToHex(digestValues[1]),
        inputDigest: bytesToHex(digestValues[2]),
        fileCount: 1,
        totalBytes: 10,
        fileRecords: expect.arrayContaining([
          expect.objectContaining({
            label: "a.txt",
            relativePath: "docs/a.txt",
            sha256: bytesToHex(digestValues[0]),
            byteSize: 10,
          }),
        ]),
      },
      files: expect.arrayContaining([
        expect.objectContaining({
          sha256: bytesToHex(digestValues[0]),
          byteSize: 10,
          relativePath: "docs/a.txt",
        }),
      ]),
      checkpoint: {
        checkpointId: `unit-prefix:${bytesToHex(digestValues[1])}`,
        parentCheckpointId: "",
        mode: "mode-a",
        source: "ui",
        manifestDigest: bytesToHex(digestValues[1]),
        inputDigest: bytesToHex(digestValues[2]),
      },
    });
    expect(uploadSessionChunkMock).toHaveBeenCalledTimes(2);
    expect(uploadSessionChunkMock.mock.calls[0]).toEqual(["session-1", 0, 3, expect.any(Blob)]);
    expect(uploadSessionChunkMock.mock.calls[1][2]).toBe(7);

    expect(result).toMatchObject({
      sessionId: "session-1",
      totalBytes: 10,
      manifestDigest: bytesToHex(digestValues[1]),
      inputDigest: bytesToHex(digestValues[2]),
      checkpointId: `unit-prefix:${bytesToHex(digestValues[1])}`,
    });
    expect(result.fileDigests[0]).toMatchObject({
      name: "a.txt",
      sha256: bytesToHex(digestValues[0]),
      byteSize: 10,
      relativePath: "docs/a.txt",
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "session", message: "准备上传会话..." }),
    );
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "upload", percent: 100, uploadedBytes: 10 }),
    );
  });
});

describe("console-model-utils", () => {
  it("normalizes model settings and module access", () => {
    expect(modelUtils.asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(modelUtils.asRecord([1, 2])).toEqual(null);

    expect(modelUtils.normalizeModelLibraryEntries(["openai-chatgpt", "openai-chatgpt", "unknown", ""])).toEqual([
      "openai-chatgpt",
    ]);

    const deterministic = modelUtils.modelAgentUid("a", "b");
    expect(deterministic).toMatch(/^agent_[0-9a-f]{16}$/);
    expect(modelUtils.modelAgentUid("a", "b")).toBe(deterministic);

    expect(modelUtils.modelEntryStringField({ model: "gpt", engine: "legacy" }, ["engine", "model"])).toBe("legacy");

    expect(modelUtils.modelProviderLabel("openai-chatgpt")).toBe("ChatGPT");
    expect(modelUtils.modelProviderLabel("google-gemini")).toBe("Gemini");
    expect(modelUtils.modelProviderLabel("openrouter")).toBe("OpenRouter");
    expect(modelUtils.modelProviderLabel("deepseek")).toBe("DeepSeek");
    expect(modelUtils.modelProviderLabel("copilot")).toBe("Copilot");
    expect(modelUtils.modelProviderLabel("custom-http")).toBe("HTTP Adapter");
    expect(modelUtils.modelProviderLabel("local-model")).toBe("本地模型");
    expect(modelUtils.modelProviderLabel("unknown")).toBe("unknown");

    expect(
      modelUtils.normalizeAgentModelEntry(
        {
          provider: "deepseek",
          model: "deepseek-chat",
          alias: "my-alias",
        },
        1,
      ),
    ).toEqual(
      expect.objectContaining({
        provider: "deepseek",
        model: "deepseek-chat",
        label: "my-alias",
        agentName: "my-alias",
        alias: expect.stringMatching(/^agent_[0-9a-f]{16}$/),
        uid: expect.stringMatching(/^agent_[0-9a-f]{16}$/),
        instanceId: expect.stringMatching(/^agent_[0-9a-f]{16}$/),
      }),
    );
    expect(
      modelUtils.normalizeAgentModelEntry(
        {
          provider: "node",
          apiKey: "k",
          timeoutMs: 5000,
        },
        2,
      ).provider,
    ).toBe("node");
    expect(
      modelUtils.normalizeAgentModelEntry(
        {
          provider: "deepseek",
          instanceId: "agent_xxx",
          uid: "agent_manual",
          model: "deepseek-chat",
          timeoutMs: 10,
        } as any,
      ).uid,
    ).toBe("agent_manual");

    expect(modelUtils.normalizeAgentModuleAccess({})).toEqual({ mode: "all", moduleIds: [] });

    expect(modelUtils.normalizeAgentModuleAccess({ mode: "selected", moduleIds: ["a", "a", "", "b"] })).toEqual({
      mode: "selected",
      moduleIds: ["a", "b"],
    });

    const draft = modelUtils.normalizeAgentPermissionGroupDraft({ label: "组", scopeIds: ["a", "a"] }, 0);
    expect(draft).toMatchObject({
      label: "组",
      scopeIds: ["a"],
      enabled: true,
    });
    const normalizedGroups = modelUtils.normalizeAgentPermissionGroupsDraft([
      { id: "g1", label: "A", scopeIds: ["x", "x"] },
      { id: "g1", label: "B", scopeIds: ["y"] },
      { id: "", scopeIds: [] },
    ]);
    expect(normalizedGroups).toHaveLength(2);
    expect(normalizedGroups[0]).toMatchObject({ id: "g1", scopeIds: ["x"] });
    expect(normalizedGroups[1].id).toMatch(/^agent-permission-/);
  });

  it("normalizes redact and provider settings snapshots", () => {
    const entry = {
      provider: "openai-chatgpt",
      model: "gpt",
      uid: "agent_001",
      instanceId: "agent_001",
      alias: "agent_001",
      baseUrl: "",
      url: "",
      apiKey: "secret",
      token: "token-secret",
      tokenHeader: "x",
      tokenPrefix: "y",
      agentName: "",
      engine: "",
      pluginList: [],
      systemPrompt: "",
      parameters: {},
      moduleAccess: { mode: "all", moduleIds: [] },
      permissionGroupId: "",
      parametersText: "{}",
      timeoutMs: 123,
    } as any;

    expect(modelUtils.redactAgentModelEntryForExport(entry)).toMatchObject({
      apiKey: "",
      apiKeyConfigured: true,
      token: "",
      tokenConfigured: true,
    });

    expect(
      modelUtils.redactedProviderSettingsForAgentExport(
        { provider: "deepseek", model: "deepseek-chat", apiKey: "", apiKeyConfigured: true } as any,
        { ...emptySettings, deepSeekApiKeyConfigured: true },
        {},
      ),
    ).toEqual(
      expect.objectContaining({
        provider: "deepseek",
        deepSeekModel: "deepseek-chat",
        deepSeekApiKeyConfigured: true,
      }),
    );
    expect(
      modelUtils.redactedProviderSettingsForAgentExport(
        { provider: "custom-http", model: "local", token: "abc", tokenHeader: "Authorization" } as any,
        emptySettings,
        {},
      ),
    ).toMatchObject({
      provider: "custom-http",
      tokenConfigured: true,
      tokenHeader: "Authorization",
    });

    expect(modelUtils.modelEntryParameters({ ...entry, parametersText: "not-json" } as any)).toEqual(entry.parameters);
    expect(modelUtils.modelEntryParameters({ ...entry, parametersText: "{\"x\":1}" } as any)).toEqual({ x: 1 });
  });

  it("normalizes provider export payloads for all supported providers", () => {
    expect(
      modelUtils.redactedProviderSettingsForAgentExport(
        { provider: "google-gemini", model: "gemini-1.5-flash" } as any,
        { googleModel: "gemini", googleApiKey: "x", googleApiKeyConfigured: true } as any,
      ),
    ).toEqual(
      expect.objectContaining({
        provider: "google-gemini",
        googleModel: "gemini-1.5-flash",
        googleApiKeyConfigured: true,
      }),
    );

    expect(
      modelUtils.redactedProviderSettingsForAgentExport(
        { provider: "openrouter", model: "or-model" } as any,
        {
          openRouterBaseUrl: "https://openrouter.ai",
          openRouterApiKey: "k",
          openRouterModel: "fallback",
        } as any,
      ),
    ).toEqual(
      expect.objectContaining({
        provider: "openrouter",
        openRouterBaseUrl: "https://openrouter.ai",
        openRouterModel: "or-model",
        openRouterApiKeyConfigured: true,
      }),
    );

    expect(
      modelUtils.redactedProviderSettingsForAgentExport(
        { provider: "copilot", model: "copilot-model" } as any,
        {
          copilotEndpoint: "https://copilot",
          copilotModel: "fallback",
          copilotApiKey: "k",
        } as any,
      ),
    ).toEqual(
      expect.objectContaining({
        provider: "copilot",
        copilotEndpoint: "https://copilot",
        copilotModel: "copilot-model",
        copilotApiKeyConfigured: true,
      }),
    );

    expect(
      modelUtils.redactedProviderSettingsForAgentExport(
        { provider: "local-model", model: "llama" } as any,
        { localModelEndpoint: "http://localhost", localModelName: "m" } as any,
      ),
    ).toEqual(
      expect.objectContaining({
        provider: "local-model",
        localModelEndpoint: "http://localhost",
        localModelName: "llama",
      }),
    );

    expect(
      modelUtils.redactedProviderSettingsForAgentExport(
        { provider: "unknown", model: "x" } as any,
        emptySettings,
      ),
    ).toEqual({ provider: "unknown" });
  });

  it("normalizes module profiles and local command definitions", () => {
    expect(modelUtils.moduleAgentProfileJson("{\"x\":1}")).toEqual({ x: 1 });
    expect(modelUtils.moduleAgentProfileJson("bad", { fallback: true })).toEqual({ fallback: true });

    expect(modelUtils.normalizeModuleAgentProfile({ contextProfileId: "ctx", parametersText: "{\"a\":1}" } as any)).toEqual(
      expect.objectContaining({
        contextProfileId: "ctx",
        parameters: { a: 1 },
        parametersText: "{\"a\":1}",
      }),
    );

    const normalizedProfiles = modelUtils.normalizeModuleAgentProfilesForDraft({
      ...emptySettings,
      moduleAgentProfiles: {
        analysis: {},
        image: { unknown: "x", primaryAgent: "m1" } as any,
      },
      moduleModelAssignments: { analysis: { model: "agent-1" } },
      moduleGroupDefinitions: moduleGroupDefinitions as any,
    } as any);
    expect(normalizedProfiles).toHaveProperty("analysis.primaryAgent", "agent-1");
    expect(normalizedProfiles.analysis.agents["agent-1"]).toEqual(
      expect.objectContaining({
        role: "primary",
      }),
    );

    expect(modelUtils.normalizeAgentLocalCommandsForDraft(emptySettings)).toEqual(
      expect.any(Array),
    );
    expect(
      modelUtils.normalizeAgentLocalCommandsForDraft({
        ...emptySettings,
        agentToolExecution: {
          ...emptySettings.agentToolExecution,
          local: {
            nodeCommand: "",
            commands: [{ commandId: "node-version", variables: [] }],
          },
        },
      } as any),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "node-version",
          args: ["{{flag}}"],
        }),
      ]),
    );
  });

  it("normalizes local command defaults and aliases", () => {
    expect(
      modelUtils.normalizeAgentLocalCommandsForDraft({
        ...emptySettings,
        agentToolExecution: {
          ...emptySettings.agentToolExecution,
          local: {
            nodeCommand: "node",
            commands: [
              { commandId: "node-version", command: "/usr/bin/node" },
              { commandId: "custom", command: "", args: ["--help"] },
              { commandId: "script", command: "bash", args: ["{{flag}}", "echo"] },
            ],
          },
        },
      } as any),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "node-version",
          command: "node",
          args: ["{{flag}}"],
        }),
        expect.objectContaining({
          commandId: "script",
          command: "bash",
          args: ["{{flag}}", "echo"],
        }),
      ]),
    );
  });
});

describe("console-defaults", () => {
  it("exports expected provider and module defaults", () => {
    expect(modelLibraryProviderDefinitions.length).toBeGreaterThan(0);
    expect(modelLibraryProviderDefinitions.map((entry) => entry.id)).toContain("openai-chatgpt");
    expect(moduleGroupDefinitions.length).toBe(5);
  });
});

describe("console-evidence-rendering", () => {
  const evidenceContext = {
    origin: () => "https://test.example",
    imageAssets: () => [
      { assetId: "image-1", title: "图一", mediaType: "image/png" } as any,
      { assetId: "image-2", title: "图二", mediaType: "image/jpeg" } as any,
    ],
    assetUrlForReference: (reference: string) => {
      if (reference === "cid:image-1") {
        return "https://assets.example/image-1.png";
      }
      if (reference === "image-1") {
        return "https://assets.example/image-1.png";
      }
      if (reference === "image-2") {
        return "https://assets.example/image-2.png";
      }
      return `https://assets.example/${reference}`;
    },
    assetUrlForAssetId: (assetId: string) => `https://assets.example/${assetId}.png`,
  };

  it("rewrites safe email image links and css urls", () => {
    expect(evidenceRendering.safeEmailImageSrc("cid:image-1", evidenceContext)).toBe("https://assets.example/image-1.png");
    expect(
      evidenceRendering.sanitizeEmailCssUrls("body{background:url(cid:image-1)}", evidenceContext),
    ).toBe('body{background:url("https://assets.example/image-1.png")}')
    ;
    expect(
      evidenceUtils.rewriteInlineAssetRefs(
        '<img src="image-1" background="image-2"><a href="cid:image-2">x</a>',
        evidenceContext.assetUrlForReference,
      ),
    ).toContain("https://assets.example/image-1");
  });

  it("validates evidence URL helpers and safe css rewriting", () => {
    expect(
      evidenceUtils.decodeURIComponentSafe("%E6%B5%8B%E8%AF%95").toLowerCase(),
    ).toBe("测试");
    expect(evidenceUtils.decodeURIComponentSafe("%E6%B5%8B%E8")).toBe("%E6%B5%8B%E8");
    expect(
      evidenceUtils.safeEmailImageSrc("https://safe.test/a.png", {
        origin: "https://safe.test",
        assetUrlForReference: () => "",
      }),
    ).toBe("https://safe.test/a.png");
    expect(
      evidenceUtils.safeEmailImageSrc("https://track.example.com/pixel.png", {
        origin: "https://safe.test",
        assetUrlForReference: () => "",
      }),
    ).toBe("");
    expect(evidenceUtils.sanitizeEmailCssUrls("background:url(image.png)", (value) => value)).toBe(
      'background:url("image.png")',
    );
    expect(
      evidenceUtils.sanitizeEmailCssUrls("background:url(javascript:alert(1))", (value) => value),
    ).toBe('background:url("javascript:alert(1"))');
    expect(evidenceUtils.assetIdsEmbeddedInHtml("/api/knowledge/assets/foo%20bar.png")).toEqual(new Set(["foo bar.png"]));
  });

  it("sanitizes framed html and removes unsafe attributes", () => {
    const html =
      "<div><img src=\"cid:image-1\" onclick=\"x()\"/><a href=\"javascript:alert(1)\">x</a>" +
      "<iframe sandbox=\"allow-same-origin allow-top-navigation-by-user-activation allow-popups-to-escape-sandbox\" " +
      "src=\"https://frame.example\"></iframe></div>";
    const frame = evidenceRendering.sanitizeEmailFrameDocument(html, evidenceContext);
    expect(frame).toContain("<!doctype html>");
    expect(frame).toContain('sandbox="allow-top-navigation-by-user-activation allow-popups"');
    expect(frame).not.toContain("onclick");
    expect(frame).not.toContain("javascript:alert(1)");
  });

  it("renders hidden nodes and missing image placeholders", () => {
    const hiddenNode = new DOMParser().parseFromString(
      '<div hidden style="display:none"><span>x</span></div>',
      "text/html",
    ).body.firstElementChild!;
    expect(evidenceRendering.renderEmailNode(hiddenNode, evidenceContext)).toBe("");

    const missingImage = new DOMParser().parseFromString('<img title="missing" />', "text/html").querySelector("img")!;
    expect(evidenceRendering.renderEmailNode(missingImage, evidenceContext)).toContain("alt=\"missing\"");

    const nodeText = new DOMParser().parseFromString("x y", "text/html").createTextNode("x y");
    expect(evidenceRendering.renderEmailNode(nodeText, evidenceContext)).toBe("x y");
  });

  it("renders email nodes and readable html", () => {
    const html = "<h1>标题</h1><p>正文<br />下一行</p><img src=\"https://a.example/i.png\" alt=\"A\" />";
    const rendered = evidenceRendering.renderReadableHtmlDocument(html, evidenceContext, {
      headers: [
        ["Subject", "测试邮件"],
        ["Date", "2026-06-04"],
      ],
    });
    expect(rendered).toContain("rendered-email-headers");
    expect(rendered).toContain("<article class=\"rendered-email rendered-email-reader\">");
    expect(rendered).toContain("测试邮件");

    const frame = evidenceRendering.renderEmailFrame("<p>hello</p>", evidenceContext);
    expect(frame).toContain("rendered-email-frame");
    expect(frame).toContain("sandbox=\"allow-popups\"");

    const doc = new DOMParser().parseFromString("<p>text</p>", "text/html");
    const image = new DOMParser().parseFromString("<img src=\"https://a.example/i.png\" alt=\"A\" />", "text/html")
      .querySelector("img")!;
    expect(evidenceRendering.renderEmailNode(doc.body, evidenceContext)).toBe("<p>text</p>");
    expect(evidenceRendering.renderEmailNode(image, evidenceContext)).toContain("figure");
  });

  it("renders evidence readable outputs for different kinds", () => {
    const markdown = `![A](cid:image-1)`;
    expect(evidenceRendering.renderEvidenceReadableHtml({ text: "A", kind: "图片" }, evidenceContext)).toContain("rendered-image-grid");
    expect(evidenceRendering.renderEvidenceReadableHtml({ text: markdown, kind: "Markdown" }, evidenceContext)).toContain(
      "rendered-inline-assets",
    );

    const emlRaw = [
      "From: alice@example.com",
      "Subject: 测试",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "hello world",
    ].join("\r\n");
    expect(evidenceRendering.renderEvidenceReadableHtml({ text: emlRaw, kind: "EML" }, evidenceContext)).toContain(
      "rendered-email-frame",
    );
    expect(evidenceRendering.renderEvidenceReadableHtml({ text: "<h1>h</h1>", kind: "HTML" }, evidenceContext)).toContain(
      "rendered-email-frame",
    );
  });
});
