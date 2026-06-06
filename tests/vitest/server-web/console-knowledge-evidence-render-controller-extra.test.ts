// @vitest-environment jsdom
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleKnowledgeEvidenceRenderController } from "../../../server-web/composables/console-knowledge-evidence-render-controller";
import type { EvidencePack } from "../../../server-web/lib/types";

vi.mock("../../../server-web/lib/browser-window", () => ({
  browserLocationOrigin: () => "https://console.test",
}));

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  knowledgeAssetUrl: (assetId: string) => `https://assets.test/${encodeURIComponent(assetId)}`,
}));

function makeEvidence(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    evidenceId: "ev-1",
    title: "证据标题",
    text: "正文内容",
    snippet: "摘要",
    reasons: ["命中规则", { ruleId: "rule-2", weight: 0.7 } as any],
    sourceLocator: { sourcePath: "/mail/source.eml", batchId: "batch-1" },
    document: {
      title: "直接文档",
      documentId: "doc-direct",
      documentType: "message",
      mediaType: "message/rfc822",
      sourcePath: "/mail/direct.eml",
    },
    section: {
      title: "直接章节",
      sectionId: "sec-direct",
    },
    blocks: [
      { text: " 第一段 " },
      { snippet: "第二段" },
    ],
    assets: [
      {
        assetId: "direct-image",
        mediaType: "image/png",
        title: "直接图片",
      },
    ],
    ...overrides,
  };
}

function createFixture(evidence: EvidencePack | null, selectedEvidenceId = "") {
  const selectedEvidence = ref<EvidencePack | null>(evidence);
  const selectedEvidenceIdRef = ref(selectedEvidenceId);
  return createConsoleKnowledgeEvidenceRenderController({
    selectedEvidence,
    selectedEvidenceId: selectedEvidenceIdRef,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("console knowledge evidence render controller extra coverage", () => {
  it("prefers direct evidence fields while merging payload assets and metadata", () => {
    const controller = createFixture(
      makeEvidence({
        payload: {
          document: {
            title: "payload 文档",
            documentId: "doc-payload",
            documentType: "message",
            mediaType: "text/html",
            sourcePath: "/mail/payload.html",
          },
          section: {
            title: "payload 章节",
            sectionId: "sec-payload",
          },
          blocks: [
            { text: " payload 第一段 " },
            { snippet: " payload 第二段 " },
          ],
          assets: [
            {
              assetId: "payload-image",
              mediaType: "image/jpeg",
              title: "payload 图片",
            },
          ],
        },
      }),
      "",
    );

    expect(controller.selectedEvidenceDisplayTitle.value).toBe("证据标题");
    expect(controller.selectedEvidencePayload.value).toMatchObject({
      document: {
        title: "payload 文档",
        documentId: "doc-payload",
      },
    });
    expect(controller.selectedEvidenceDocument.value).toMatchObject({
      title: "直接文档",
      documentId: "doc-direct",
      documentType: "message",
    });
    expect(controller.selectedEvidenceSection.value).toMatchObject({
      title: "直接章节",
      sectionId: "sec-direct",
    });
    expect(controller.selectedEvidenceBlocks.value).toEqual([
      { text: " 第一段 " },
      { snippet: "第二段" },
    ]);
    expect(controller.evidenceAssets.value).toHaveLength(2);
    expect(controller.renderEvidenceImageGallery()).toContain("直接图片");
    expect(controller.renderEvidenceImageGallery()).toContain("payload 图片");
    expect(controller.evidencePrimaryText()).toBe("第一段\n\n第二段");
    expect(controller.evidenceMainText()).toBe("第一段\n\n第二段");
    expect(controller.evidenceReadableKind.value).toBe("EML");
    expect(controller.evidenceReadableKindLabel()).toBe("EML");
    expect(controller.evidenceSourceHint()).toContain("message");
    expect(controller.evidenceSourceHint()).toContain("/mail/direct.eml");
    expect(controller.evidenceSourceDetails()).toEqual([
      { label: "文档", value: "直接文档" },
      { label: "章节", value: "直接章节" },
      { label: "来源", value: "/mail/source.eml" },
      { label: "批次", value: "batch-1" },
    ]);
    expect(controller.evidenceReasonText()).toBe("命中规则；{\"ruleId\":\"rule-2\",\"weight\":0.7}");
  });

  it("classifies readable kinds from source hints and renders wrappers", () => {
    const fallbackController = createFixture(
      makeEvidence({
        title: "",
        text: "",
        snippet: "",
        reasons: [],
        document: undefined,
        section: undefined,
        blocks: undefined,
        assets: [],
        sourceLocator: { sourcePath: "/mail/archive.html" },
        payload: {
          document: {
            title: "payload 文档",
            documentId: "doc-payload",
            documentType: "html",
            mediaType: "text/html",
            sourcePath: "/mail/archive.html",
          },
          section: {
            title: "payload 章节",
            sectionId: "sec-payload",
          },
          blocks: [
            { text: " payload 第一段 " },
            { snippet: " payload 第二段 " },
          ],
          assets: [
            {
              assetId: "payload-image",
              mediaType: "image/jpeg",
              title: "payload 图片",
            },
          ],
        },
      }),
      "",
    );
    expect(fallbackController.selectedEvidenceDocument.value).toMatchObject({
      title: "payload 文档",
      documentId: "doc-payload",
    });
    expect(fallbackController.selectedEvidenceSection.value).toMatchObject({
      title: "payload 章节",
      sectionId: "sec-payload",
    });
    expect(fallbackController.selectedEvidenceBlocks.value).toEqual([
      { text: " payload 第一段 " },
      { snippet: " payload 第二段 " },
    ]);
    expect(fallbackController.evidenceAssets.value).toHaveLength(1);
    expect(fallbackController.evidencePrimaryText()).toBe("payload 第一段\n\npayload 第二段");

    const htmlEvidence = createFixture(
      makeEvidence({
        title: "",
        text: "",
        snippet: "",
        reasons: [],
        sourceLocator: { sourcePath: "/mail/archive.html" },
        document: {
          title: "",
          documentId: "",
          documentType: "html",
          mediaType: "text/html",
          sourcePath: "/mail/archive.html",
        },
        assets: [],
        blocks: [],
        payload: {
          document: {
            title: "",
            documentId: "",
            documentType: "html",
            mediaType: "text/html",
            sourcePath: "/mail/archive.html",
          },
        },
      }),
      "",
    );
    expect(htmlEvidence.evidenceReadableKind.value).toBe("HTML");
    expect(htmlEvidence.evidenceReadableHtml.value).toContain("rendered-email-frame");
    expect(htmlEvidence.renderReadableHtmlDocument("<p>hello</p>", { headers: [["Subject", "主题"]] })).toContain("主题");
    expect(htmlEvidence.renderEmailFrame("<p>hello</p>")).toContain("sandbox=\"allow-popups\"");
    expect(htmlEvidence.renderEmailNode(document.createTextNode("hello"))).toBe("hello");

    const emlEvidence = createFixture(
      makeEvidence({
        title: "",
        text: "From: alice@example.com\nSubject: 邮件标题\n\n正文",
        snippet: "",
        reasons: [],
        sourceLocator: { sourcePath: "/mail/message.eml" },
        document: {
          title: "",
          documentId: "",
          documentType: "message",
          mediaType: "message/rfc822",
          sourcePath: "/mail/message.eml",
        },
        payload: {
          document: {
            title: "",
            documentId: "",
            documentType: "message",
            mediaType: "message/rfc822",
            sourcePath: "/mail/message.eml",
          },
        },
        assets: [],
        blocks: [],
      }),
      "",
    );
    expect(emlEvidence.evidenceReadableKind.value).toBe("EML");
    expect(emlEvidence.evidenceReadableHtml.value).toContain("rendered-email-frame");
    expect(emlEvidence.emailToSafeHtml("plain text")).toContain("rendered-email-frame");

    const markdownEvidence = createFixture(
      makeEvidence({
        title: "",
        text: "## 标题\n\n正文",
        snippet: "",
        reasons: [],
        sourceLocator: { sourcePath: "/notes/readme.md" },
        document: {
          title: "",
          documentId: "",
          documentType: "markdown",
          mediaType: "text/markdown",
          sourcePath: "/notes/readme.md",
        },
        assets: [
          {
            assetId: "markdown-image",
            mediaType: "image/png",
            title: "markdown 图",
          },
        ],
      }),
      "",
    );
    expect(markdownEvidence.evidenceReadableKind.value).toBe("Markdown");
    expect(markdownEvidence.evidenceReadableHtml.value).toContain("rendered-inline-assets");
    expect(markdownEvidence.embedEvidenceAssets("<p>markdown</p>")).toContain("rendered-inline-assets");

    const imageEvidence = createFixture(
      makeEvidence({
        title: "",
        text: "",
        snippet: "",
        reasons: [],
        blocks: [],
        sourceLocator: { sourcePath: "/images/capture.png" },
        document: {
          title: "",
          documentId: "",
          documentType: "image",
          mediaType: "image/png",
          sourcePath: "/images/capture.png",
        },
        assets: [
          {
            assetId: "photo-1",
            mediaType: "image/png",
            title: "截图",
          },
        ],
        payload: {
          document: {
            title: "",
            documentId: "",
            documentType: "image",
            mediaType: "image/png",
            sourcePath: "/images/capture.png",
          },
        },
      }),
      "",
    );
    expect(imageEvidence.evidenceReadableKind.value).toBe("图片");
    expect(imageEvidence.evidenceReadableHtml.value).toContain("rendered-image-grid");
    expect(imageEvidence.evidenceMainText()).toBe("当前证据没有可展示的正文。");
    expect(imageEvidence.renderEvidenceImageGallery(new Set(["photo-1"]))).toBe("");
    expect(imageEvidence.assetUrlForReference("cid:photo-1")).toBe("https://assets.test/photo-1");
    expect(imageEvidence.safeEmailImageSrc("data:image/png;base64,abc")).toBe("https://assets.test/photo-1");
    expect(imageEvidence.sanitizeEmailCssUrls("background:url(cid:photo-1)")).toContain("https://assets.test/photo-1");
    const sanitizedFrame = imageEvidence.sanitizeEmailFrameDocument('<div><img src="cid:photo-1" onclick="x()"></div>');
    expect(sanitizedFrame).toContain("https://assets.test/photo-1");
    expect(sanitizedFrame).not.toContain("onclick");
    expect(imageEvidence.rewriteInlineAssetRefs('<img src="cid:photo-1">')).toContain("https://assets.test/photo-1");
    const imageNode = document.createElement("img");
    imageNode.setAttribute("title", "替代文本");
    expect(imageEvidence.renderEmailImage(imageNode)).toContain("email-image-alt");
  });

  it("falls back to selected id and empty labels when evidence is missing", () => {
    const controller = createFixture(null, "fallback-id");

    expect(controller.selectedEvidenceDisplayTitle.value).toBe("fallback-id");
    expect(controller.selectedEvidencePayload.value).toBeNull();
    expect(controller.selectedEvidenceDocument.value).toBeNull();
    expect(controller.selectedEvidenceSection.value).toBeNull();
    expect(controller.selectedEvidenceBlocks.value).toEqual([]);
    expect(controller.evidenceAssets.value).toEqual([]);
    expect(controller.renderEvidenceImageGallery()).toBe("");
    expect(controller.evidencePrimaryText()).toBe("");
    expect(controller.evidenceMainText()).toBe("当前证据没有可展示的正文。");
    expect(controller.evidenceReadableKind.value).toBe("文本");
    expect(controller.evidenceSourceDetails()).toEqual([]);
    expect(controller.evidenceReasonText()).toBe("暂无命中说明。");
  });
});
