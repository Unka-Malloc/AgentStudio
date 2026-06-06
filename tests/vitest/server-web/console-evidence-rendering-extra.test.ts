// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as evidenceRendering from "../../../server-web/composables/console-evidence-rendering";
import type { EvidenceRenderContext } from "../../../server-web/composables/console-evidence-rendering";

vi.mock("../../../server-web/lib/browser-window", () => ({
  browserLocationOrigin: () => "https://browser-fallback.test",
}));

function createContext(overrides: Partial<EvidenceRenderContext> = {}): EvidenceRenderContext {
  return {
    origin: () => "https://evidence-render.test",
    imageAssets: () => [
      {
        assetId: "photo-1",
        title: "主图",
        mediaType: "image/png",
      },
      {
        assetId: "photo 2",
        caption: "副标题",
        mediaType: "image/png",
      },
      {
        title: "不含 id",
        mediaType: "image/png",
      },
    ],
    assetUrlForReference: (reference) => {
      if (!reference) {
        return "";
      }
      if (reference === "cid:photo-1" || reference === "photo-1") {
        return "https://assets.test/photo-1.png";
      }
      if (reference === "photo 2") {
        return "https://assets.test/photo%202.png";
      }
      if (reference === "cid:missing") {
        return "";
      }
      if (reference === "hello%20world.png" || reference === "hello world.png") {
        return "https://assets.test/hello-world.png";
      }
      if (reference.startsWith("data:")) {
        return reference;
      }
      return "";
    },
    assetUrlForAssetId: (assetId) => `https://assets.test/${assetId}.png`,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("console-evidence-rendering extended", () => {
  it("falls back to browserLocationOrigin when context origin is missing", () => {
    const context = createContext({ origin: () => "" });

    expect(evidenceRendering.safeEmailImageSrc("/assets/logo.png", context)).toBe(
      "https://browser-fallback.test/assets/logo.png",
    );
    expect(evidenceRendering.safeEmailImageSrc("https://track.example.com/pixel.gif", context)).toBe("");
    expect(evidenceRendering.safeEmailImageSrc("https://cdn.example.com/image.png?preview=1", context)).toBe("");
  });

  it("sanitizes css urls, rewrites assets, and drops unsafe urls", () => {
    const context = createContext();
    const css =
      'body{background:url(cid:photo-1);content:url("data:image/png;base64,abc");mask:url(javascript:alert(1));}';

    const sanitized = evidenceRendering.sanitizeEmailCssUrls(css, context);
    expect(sanitized).toContain('body{background:url("https://assets.test/photo-1.png")');
    expect(sanitized).toContain('content:url("data:image/png;base64,abc")');
    expect(sanitized).toContain("mask:none");
  });

  it("rewrites inline asset references for known src/background attributes", () => {
    const context = createContext();
    const html = '<img src="cid:photo-1" background="photo 2"><img src="https://safe.example/a.png">';

    const rewritten = evidenceRendering.rewriteInlineAssetRefs(html, context);
    expect(rewritten).toContain("https://assets.test/photo-1.png");
    expect(rewritten).toContain("https://assets.test/photo%202.png");
  });

  it("sanitizes framed html by removing unsafe tags/attrs and normalizing sandbox", () => {
    const context = createContext();
    const frame = evidenceRendering.sanitizeEmailFrameDocument(
      [
        '<img src="cid:missing" onclick="x()" srcset="x 1x" onload="y()" />',
        '<a href="javascript:alert(1)">bad</a>',
        '<a href="https://safe.example/path">ok</a>',
        '<iframe src="https://frame.example" sandbox="allow-same-origin allow-top-navigation-by-user-activation"></iframe>',
        '<iframe src="https://frame2.example"></iframe>',
        '<style>.logo{background:url(cid:photo-1)}</style>',
        '<svg><text>bad</text></svg>',
        '<div hidden>hidden</div>',
        '<div style="font-size:0" media="">styled</div>',
        '<body class="content" data-custom="nope" text="black">正文</body>',
      ].join(""),
      context,
    );

    const rendered = new DOMParser().parseFromString(frame, "text/html");

    expect(rendered.querySelector("svg")).toBeNull();
    expect(rendered.querySelector('a[href="javascript:alert(1)"]')).toBeNull();
    expect(rendered.querySelector("img")?.getAttribute("src")).toBeNull();
    expect(rendered.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(rendered.querySelectorAll("a[href='https://safe.example/path']")).toHaveLength(1);
    expect(rendered.querySelector("a[href='https://safe.example/path']")?.getAttribute("target")).toBe("_blank");
    const sandboxValues = Array.from(rendered.querySelectorAll("iframe")).map((iframe) => iframe.getAttribute("sandbox"));
    expect(sandboxValues).toContain("allow-top-navigation-by-user-activation allow-popups");
    expect(sandboxValues).toContain("allow-popups");
    expect(sandboxValues).toHaveLength(2);
    expect(rendered.querySelector("body")?.getAttribute("style")).toBeNull();
    expect(rendered.querySelector('div[style="font-size:0"]').getAttribute("style")).toBe("font-size:0");
    expect(rendered.querySelector("body")?.getAttribute("data-custom")).toBeNull();
    expect(rendered.querySelector("body")?.getAttribute("class")).toBe("content");
    expect(rendered.querySelector("body")?.getAttribute("text")).toBe("black");
    expect(rendered.querySelector("body")?.textContent || "").toContain("正文");
    expect(frame).toContain("background:url(\"https://assets.test/photo-1.png\")");
    expect(frame).not.toContain("onclick");
    expect(frame).not.toContain("srcset");
    expect(frame).toContain("allow-top-navigation-by-user-activation allow-popups");
    expect(frame).toContain("referrerpolicy=\"no-referrer\"");
  });

  it("normalizes standalone image nodes with missing or present src", () => {
    const context = createContext();
    const missingImage = new DOMParser().parseFromString("<img title=\"alt 文本\"/>", "text/html").querySelector("img")!;
    expect(evidenceRendering.renderEmailImage(missingImage, context)).toBe('<span class="email-image-alt">alt 文本</span>');

    const readyImage = new DOMParser().parseFromString("<img src=\"cid:photo-1\"/>", "text/html").querySelector("img")!;
    const rendered = evidenceRendering.renderEmailImage(readyImage, context);
    expect(rendered).toContain('class="email-inline-image"');
    expect(rendered).toContain('src="https://assets.test/photo-1.png"');
    expect(rendered).toContain('alt="email image"');
  });

  it("renders different email node branches and normalizes whitespace", () => {
    const context = createContext();
    const textNode = new DOMParser().parseFromString("x   y", "text/html").createTextNode("x   y");
    expect(evidenceRendering.renderEmailNode(textNode, context)).toBe("x y");

    const hidden = new DOMParser().parseFromString('<div hidden>不可见</div>', "text/html").querySelector("div")!;
    expect(evidenceRendering.renderEmailNode(hidden, context)).toBe("");

    const br = new DOMParser().parseFromString("<br>", "text/html").querySelector("br")!;
    expect(evidenceRendering.renderEmailNode(br, context)).toBe("<br />");

    const safeAnchor = new DOMParser().parseFromString('<a href="https://safe.example">A</a>', "text/html").querySelector("a")!;
    expect(evidenceRendering.renderEmailNode(safeAnchor, context)).toBe(
      '<a href="https://safe.example" target="_blank" rel="noreferrer noopener">A</a>',
    );

    const unsafeAnchor = new DOMParser().parseFromString('<a href="ftp://unsafe">A</a>', "text/html").querySelector("a")!;
    expect(evidenceRendering.renderEmailNode(unsafeAnchor, context)).toBe("A");

    const blockNode = new DOMParser().parseFromString('<div style="display:block"><span>普通</span></div>', "text/html").querySelector("div")!;
    expect(evidenceRendering.renderEmailNode(blockNode, context)).toBe("<p>普通</p>");

    const blockList = new DOMParser().parseFromString('<ul><li>第一项</li><li>第二项</li></ul>', "text/html").querySelector("ul")!;
    expect(evidenceRendering.renderEmailNode(blockList, context)).toBe("<ul><li>第一项</li><li>第二项</li></ul>");

    const withHeading = new DOMParser().parseFromString("<h2>标题</h2>", "text/html").querySelector("h2")!;
    expect(evidenceRendering.renderEmailNode(withHeading, context)).toBe("<h4>标题</h4>");

    const table = new DOMParser().parseFromString("<table><tr><td>a</td></tr></table>", "text/html").querySelector("table")!;
    expect(evidenceRendering.renderEmailNode(table, context)).toContain("email-reader-group");

    const code = new DOMParser().parseFromString('<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>', "text/html")
      .querySelector("code")!;
    expect(evidenceRendering.renderEmailNode(code, context)).toBe("<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>");
  });

  it("renders readable document with explicit headers, meta headers, and fallback content", () => {
    const context = createContext();

    const withHeaders = evidenceRendering.renderReadableHtmlDocument("<p>正文</p>", context, {
      headers: [
        ["Subject", "邮件主题"],
        ["Date", "2026-06-04"],
      ],
    });
    expect(withHeaders).toContain("邮件主题");
    expect(withHeaders).toContain("2026-06-04");
    expect(withHeaders).toContain("正文");

    const withMeta = evidenceRendering.renderReadableHtmlDocument(
      '<meta name="message:raw-header:From" content="meta@local">x</body>',
      context,
      {},
    );
    expect(withMeta).toContain("meta@local");

    const withNoReadableNodes = evidenceRendering.renderReadableHtmlDocument("<div hidden>hidden</div>", context, {});
    expect(withNoReadableNodes).toContain("hidden");
  });

  it("converts email payloads to frame form for html and plain text", () => {
    const context = createContext();
    const html = evidenceRendering.emailToSafeHtml("<p>body</p>", context);
    const plain = evidenceRendering.emailToSafeHtml("just plain text", context);

    expect(html).toContain("rendered-email-frame");
    expect(plain).toContain("&lt;pre&gt;just plain text&lt;/pre&gt;");
  });

  it("builds image gallery variants and embed inline assets", () => {
    const context = createContext();
    expect(evidenceRendering.renderEvidenceImageGallery(context)).toContain("rendered-image-grid");
    expect(evidenceRendering.renderEvidenceImageGallery(context, new Set(["photo-1", "photo 2"]))).toBe(
      '<div class="rendered-image-grid"></div>',
    );
    expect(evidenceRendering.renderEvidenceImageGallery({ ...context, imageAssets: () => [] })).toBe("");
    expect(
      evidenceRendering.embedEvidenceAssets("<p>文本</p>", {
        ...context,
        imageAssets: () => [],
      }),
    ).toBe("<p>文本</p>");

    const withAsset = evidenceRendering.embedEvidenceAssets(
      '<p><img src="/api/knowledge/assets/existing.png"/></p>',
      createContext({
        assetUrlForAssetId: () => "https://assets.test/hello-world.png",
        imageAssets: () => [
          {
            assetId: "hello world.png",
            title: "路径",
            mediaType: "image/png",
          },
        ],
      }),
    );
    expect(withAsset).toContain('section class="rendered-inline-assets"');
    expect(withAsset).toContain('src="https://assets.test/hello-world.png"');
  });

  it("renders different evidence-readable kinds and handles empty/null text safely", () => {
    const galleryContext = createContext();
    expect(evidenceRendering.renderEvidenceReadableHtml({ text: "", kind: "图片" }, galleryContext)).toContain(
      "rendered-image-grid",
    );

    expect(
      evidenceRendering.renderEvidenceReadableHtml({ text: "", kind: "图片" }, { ...galleryContext, imageAssets: () => [] }),
    ).toContain("当前证据没有可展示的正文。");

    expect(evidenceRendering.renderEvidenceReadableHtml({ text: "<h1>x</h1>", kind: "HTML" }, galleryContext)).toContain(
      "rendered-email-frame",
    );

    expect(evidenceRendering.renderEvidenceReadableHtml({ text: "# 标题", kind: "Markdown" }, galleryContext)).toContain(
      "rendered-inline-assets",
    );

    expect(evidenceRendering.renderEvidenceReadableHtml({ text: "", kind: "文本" }, galleryContext)).toContain(
      "<p>当前证据没有可展示的正文。</p>",
    );

    expect(
      evidenceRendering.renderEvidenceReadableHtml({ text: "" as any, kind: "EML" }, galleryContext),
    ).toContain("rendered-email-frame");
    expect(evidenceRendering.renderEvidenceReadableHtml({ text: null as any, kind: "文本" }, galleryContext)).toContain(
      "当前证据没有可展示的正文。",
    );
  });
});
