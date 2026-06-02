import { computed, type Ref } from "vue";
import { browserLocationOrigin } from "../lib/browser-window";
import { knowledgeAssetUrl } from "../lib/knowledge-search-client";
import type {
  EvidencePack,
  KnowledgeAssetRef,
} from "../lib/types";
import {
  evidenceDisplayTitle,
} from "./console-knowledge-search-utils";
import {
  isImageAsset,
  resolveEvidenceAssetUrl,
} from "./console-evidence-utils";
import {
  emailToSafeHtml as emailToSafeHtmlCore,
  embedEvidenceAssets as embedEvidenceAssetsCore,
  renderEmailFrame as renderEmailFrameCore,
  renderEmailImage as renderEmailImageCore,
  renderEmailNode as renderEmailNodeCore,
  renderEvidenceImageGallery as renderEvidenceImageGalleryCore,
  renderEvidenceReadableHtml as renderEvidenceReadableHtmlCore,
  renderReadableHtmlDocument as renderReadableHtmlDocumentCore,
  rewriteInlineAssetRefs as rewriteInlineAssetRefsCore,
  safeEmailImageSrc as safeEmailImageSrcCore,
  sanitizeEmailCssUrls as sanitizeEmailCssUrlsCore,
  sanitizeEmailFrameDocument as sanitizeEmailFrameDocumentCore,
  type EvidenceReadableKindLabel,
  type EvidenceRenderContext,
} from "./console-evidence-rendering";
import { asRecord } from "./console-model-utils";

type ConsoleKnowledgeEvidenceRenderControllerOptions = {
  selectedEvidence: Ref<EvidencePack | null>;
  selectedEvidenceId: Ref<string>;
};

export function createConsoleKnowledgeEvidenceRenderController(
  options: ConsoleKnowledgeEvidenceRenderControllerOptions,
) {
  const selectedEvidenceDisplayTitle = computed(() =>
    options.selectedEvidence.value
      ? evidenceDisplayTitle(options.selectedEvidence.value)
      : options.selectedEvidenceId.value || "来源详情",
  );
  const selectedEvidencePayload = computed(() =>
    asRecord(options.selectedEvidence.value?.payload) || null,
  );
  const selectedEvidenceDocument = computed(() =>
    (asRecord(options.selectedEvidence.value?.document) ||
      asRecord(selectedEvidencePayload.value?.document) ||
      null) as Record<string, unknown> | null,
  );
  const selectedEvidenceSection = computed(() =>
    (asRecord(options.selectedEvidence.value?.section) ||
      asRecord(selectedEvidencePayload.value?.section) ||
      null) as Record<string, unknown> | null,
  );
  const selectedEvidenceBlocks = computed(() => {
    const direct = Array.isArray(options.selectedEvidence.value?.blocks)
      ? options.selectedEvidence.value?.blocks
      : Array.isArray(selectedEvidencePayload.value?.blocks)
        ? selectedEvidencePayload.value?.blocks
        : [];
    return (direct || []).map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[];
  });
  const evidenceAssets = computed(() => {
    const direct = options.selectedEvidence.value?.assets || [];
    const payloadAssets = Array.isArray(selectedEvidencePayload.value?.assets)
      ? selectedEvidencePayload.value?.assets
      : [];
    return [...direct, ...payloadAssets].filter(Boolean) as KnowledgeAssetRef[];
  });

  const evidenceReadableHtml = computed(() => renderEvidenceReadableHtml());
  const evidenceReadableKind = computed(() => evidenceReadableKindLabel());

  function evidencePrimaryText() {
    const blockText = selectedEvidenceBlocks.value
      .map((block) => String(block.text || block.snippet || "").trim())
      .filter(Boolean)
      .join("\n\n");
    return String(
      blockText ||
      options.selectedEvidence.value?.text ||
      options.selectedEvidence.value?.snippet ||
      "",
    ).trim();
  }

  function evidenceMainText() {
    return evidencePrimaryText() || "当前证据没有可展示的正文。";
  }

  function imageEvidenceAssets() {
    return evidenceAssets.value.filter((asset) => isImageAsset(asset));
  }

  function assetUrlForReference(reference: string) {
    return resolveEvidenceAssetUrl(
      reference,
      imageEvidenceAssets(),
      knowledgeAssetUrl,
    );
  }

  function evidenceRenderContext(): EvidenceRenderContext {
    return {
      origin: () => browserLocationOrigin(),
      imageAssets: imageEvidenceAssets,
      assetUrlForReference,
      assetUrlForAssetId: knowledgeAssetUrl,
    };
  }

  function safeEmailImageSrc(value: string) {
    return safeEmailImageSrcCore(value, evidenceRenderContext());
  }

  function sanitizeEmailCssUrls(value: string) {
    return sanitizeEmailCssUrlsCore(value, evidenceRenderContext());
  }

  function sanitizeEmailFrameDocument(rawHtml: string) {
    return sanitizeEmailFrameDocumentCore(rawHtml, evidenceRenderContext());
  }

  function renderEmailFrame(rawHtml: string) {
    return renderEmailFrameCore(rawHtml, evidenceRenderContext());
  }

  function rewriteInlineAssetRefs(html: string) {
    return rewriteInlineAssetRefsCore(html, evidenceRenderContext());
  }

  function renderEmailImage(element: Element) {
    return renderEmailImageCore(element, evidenceRenderContext());
  }

  function renderEmailNode(node: Node): string {
    return renderEmailNodeCore(node, evidenceRenderContext());
  }

  function renderReadableHtmlDocument(rawHtml: string, optionsForRender: { headers?: Array<[string, string]>; title?: string } = {}) {
    return renderReadableHtmlDocumentCore(rawHtml, evidenceRenderContext(), optionsForRender);
  }

  function emailToSafeHtml(rawText: string) {
    return emailToSafeHtmlCore(rawText, evidenceRenderContext());
  }

  function evidenceSourceHint() {
    const locator =
      asRecord(options.selectedEvidence.value?.sourceLocator) ||
      asRecord(options.selectedEvidence.value?.locator) ||
      null;
    const documentRecord = selectedEvidenceDocument.value || {};
    return [
      documentRecord.documentType,
      documentRecord.mediaType,
      documentRecord.sourcePath,
      documentRecord.title,
      locator?.sourcePath,
      options.selectedEvidence.value?.title,
    ].map((item) => String(item || "").toLowerCase()).join(" ");
  }

  function evidenceReadableKindLabel(): EvidenceReadableKindLabel {
    const text = evidencePrimaryText();
    const hint = evidenceSourceHint();
    if (/\.(eml|msg)\b|message\/rfc822|^from:|^subject:/i.test(`${hint}\n${text.slice(0, 500)}`)) {
      return "EML";
    }
    if (/\.html?\b|text\/html|^\s*(<!doctype\s+html|<html|<body)\b/i.test(`${hint}\n${text.slice(0, 500)}`)) {
      return "HTML";
    }
    if (/\.md\b|\.markdown\b|text\/markdown/i.test(hint)) {
      return "Markdown";
    }
    if (!text && imageEvidenceAssets().length > 0) {
      return "图片";
    }
    return "文本";
  }

  function renderEvidenceImageGallery(excludedAssetIds = new Set<string>()) {
    return renderEvidenceImageGalleryCore(evidenceRenderContext(), excludedAssetIds);
  }

  function embedEvidenceAssets(html: string) {
    return embedEvidenceAssetsCore(html, evidenceRenderContext());
  }

  function renderEvidenceReadableHtml() {
    return renderEvidenceReadableHtmlCore(
      {
        text: evidencePrimaryText(),
        kind: evidenceReadableKindLabel(),
      },
      evidenceRenderContext(),
    );
  }

  function evidenceSourceDetails() {
    const locator =
      asRecord(options.selectedEvidence.value?.sourceLocator) ||
      asRecord(options.selectedEvidence.value?.locator) ||
      null;
    const document = selectedEvidenceDocument.value || {};
    const section = selectedEvidenceSection.value || {};
    return [
      { label: "文档", value: String(document.title || document.documentId || "未记录") },
      { label: "章节", value: String(section.title || section.sectionId || "未记录") },
      { label: "来源", value: String(locator?.sourcePath || "未记录") },
      { label: "批次", value: String(locator?.batchId || options.selectedEvidence.value?.batchId || "未记录") },
    ].filter((item) => item.value && item.value !== "未记录");
  }

  function evidenceReasonText() {
    const reasons = options.selectedEvidence.value?.reasons || [];
    if (!Array.isArray(reasons) || reasons.length === 0) {
      return "暂无命中说明。";
    }
    return reasons
      .map((reason) => (typeof reason === "string" ? reason : JSON.stringify(reason)))
      .join("；");
  }

  return {
    assetUrlForReference,
    emailToSafeHtml,
    embedEvidenceAssets,
    evidenceAssets,
    evidenceMainText,
    evidencePrimaryText,
    evidenceReadableHtml,
    evidenceReadableKind,
    evidenceReadableKindLabel,
    evidenceReasonText,
    evidenceSourceDetails,
    evidenceSourceHint,
    imageEvidenceAssets,
    renderEmailFrame,
    renderEmailImage,
    renderEmailNode,
    renderEvidenceImageGallery,
    renderEvidenceReadableHtml,
    renderReadableHtmlDocument,
    rewriteInlineAssetRefs,
    safeEmailImageSrc,
    sanitizeEmailCssUrls,
    sanitizeEmailFrameDocument,
    selectedEvidenceBlocks,
    selectedEvidenceDisplayTitle,
    selectedEvidenceDocument,
    selectedEvidencePayload,
    selectedEvidenceSection,
  };
}
