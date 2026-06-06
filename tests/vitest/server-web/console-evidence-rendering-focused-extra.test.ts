// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  emailToSafeHtml,
  renderEmailNode,
  renderEvidenceImageGallery,
  renderEvidenceReadableHtml,
  renderReadableHtmlDocument,
  sanitizeEmailFrameDocument,
  type EvidenceRenderContext,
} from "../../../server-web/composables/console-evidence-rendering";

function createContext(): EvidenceRenderContext {
  return {
    origin: () => "https://console.example.test",
    imageAssets: () => [
      { assetId: "asset-1", title: "Diagram" },
      { assetId: "asset-2", caption: "Screenshot" },
      { title: "missing asset id" },
    ] as never,
    assetUrlForReference: (reference) => `/assets/by-ref/${encodeURIComponent(reference)}`,
    assetUrlForAssetId: (assetId) => `/assets/by-id/${encodeURIComponent(assetId)}`,
  };
}

describe("console evidence rendering focused coverage", () => {
  it("sanitizes email frame documents and normalizes security attributes", () => {
    const html = sanitizeEmailFrameDocument(`
      <html>
        <head><style>.hero { background: url("cid:asset-1"); }</style></head>
        <body class="mail" text="#111" onclick="alert(1)">
          <iframe src="https://blocked.example" referrerpolicy="" sandbox="allow-same-origin allow-scripts allow-top-navigation-by-user-activation"></iframe>
          <img src="cid:asset-2" />
          <a href="javascript:alert(1)">bad link</a>
          <media media="">ignored media element</media>
        </body>
      </html>
    `, createContext());

    expect(html).toContain("class=\"mail\"");
    expect(html).toContain("referrerpolicy=\"no-referrer\"");
    expect(html).toContain("sandbox=\"allow-scripts allow-top-navigation-by-user-activation allow-popups\"");
    expect(html).toContain("loading=\"lazy\"");
    expect(html).toContain("alt=\"\"");
    expect(html).toContain("asset-2");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("<media");
  });

  it("renders individual email nodes for empty, block, figure, and image cases", () => {
    const context = createContext();
    const doc = new DOMParser().parseFromString(`
      <section>
        <span><script>hidden()</script></span>
        <blockquote><p>Quoted</p></blockquote>
        <figure><img alt="CID diagram" src="cid:asset-1"></figure>
        <table><tbody><tr><td>Cell</td></tr></tbody></table>
      </section>
    `, "text/html");

    expect(renderEmailNode(doc.querySelector("span")!, context)).toBe("");
    expect(renderEmailNode(doc.querySelector("blockquote")!, context)).toContain("<blockquote>");
    expect(renderEmailNode(doc.querySelector("figure")!, context)).toContain("email-inline-image");
    expect(renderEmailNode(doc.querySelector("table")!, context)).toContain("email-reader-group");
  });

  it("renders readable documents, image galleries, EML, markdown, and empty image evidence", () => {
    const context = createContext();

    const emptyReadable = renderReadableHtmlDocument("<script>hidden()</script>", context, {
      headers: [["Subject", "Monthly report"]],
    });
    expect(emptyReadable).toContain("Monthly report");
    expect(emptyReadable).toContain("hidden()");

    const gallery = renderEvidenceImageGallery(context, new Set(["asset-2"]));
    expect(gallery).toContain("Diagram");
    expect(gallery).not.toContain("Screenshot");

    const emptyImage = renderEvidenceReadableHtml({ text: "", kind: "图片" }, context);
    expect(emptyImage).toContain("rendered-image-grid");

    const markdown = renderEvidenceReadableHtml({ text: "![Alt](cid:asset-1)\n\n**Bold**", kind: "Markdown" }, context);
    expect(markdown).toContain("Bold");

    const eml = emailToSafeHtml("Subject: Plain\n\nHello plain mail", context);
    expect(eml).toContain("rendered-email-frame-shell");
    expect(eml).toContain("Hello plain mail");

    const text = renderEvidenceReadableHtml({ text: "", kind: "文本" }, context);
    expect(text).toContain("当前证据没有可展示的正文");
  });
});
