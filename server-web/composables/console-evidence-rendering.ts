import type { KnowledgeAssetRef } from "../lib/types";
import { browserLocationOrigin } from "../lib/browser-window";
import {
  emailHeaderValue,
  escapeHtmlText,
  extractEmailRenderablePart,
  markdownToSafeHtml,
  plainTextToHtml,
  safeLinkHref,
} from "../lib/rendering";
import {
  assetIdsEmbeddedInHtml,
  isHiddenEmailElement,
  normalizeRenderedText,
  renderedHtmlHasBlocks,
  rewriteInlineAssetRefs as rewriteInlineAssetRefsCore,
  safeEmailImageSrc as safeEmailImageSrcCore,
  sanitizeEmailCssUrls as sanitizeEmailCssUrlsCore,
} from "./console-evidence-utils";
import { htmlMetaHeader } from "./console-knowledge-search-utils";

export type EvidenceReadableKindLabel = "EML" | "HTML" | "Markdown" | "图片" | "文本";

export interface EvidenceRenderContext {
  origin: () => string;
  imageAssets: () => KnowledgeAssetRef[];
  assetUrlForReference: (reference: string) => string;
  assetUrlForAssetId: (assetId: string) => string;
}

function contextOrigin(context: EvidenceRenderContext) {
  return context.origin() || browserLocationOrigin();
}

export function safeEmailImageSrc(value: string, context: EvidenceRenderContext) {
  return safeEmailImageSrcCore(value, {
    origin: contextOrigin(context),
    assetUrlForReference: context.assetUrlForReference,
  });
}

export function sanitizeEmailCssUrls(value: string, context: EvidenceRenderContext) {
  return sanitizeEmailCssUrlsCore(value, (nextValue) => safeEmailImageSrc(nextValue, context));
}

export function sanitizeEmailFrameDocument(rawHtml: string, context: EvidenceRenderContext) {
  const origin = contextOrigin(context);
  const source = rewriteInlineAssetRefs(String(rawHtml || ""), context);
  const doc = new DOMParser().parseFromString(
    /<html[\s>]|<body[\s>]|<!doctype/i.test(source)
      ? source
      : `<!doctype html><html><body>${source}</body></html>`,
    "text/html",
  );
  for (const element of Array.from(doc.querySelectorAll("script, iframe, object, embed, form, input, button, textarea, select"))) {
    element.remove();
  }
  for (const element of Array.from(doc.querySelectorAll("style"))) {
    element.textContent = sanitizeEmailCssUrls(element.textContent || "", context);
  }
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || "";
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        element.setAttribute(attribute.name, sanitizeEmailCssUrls(value, context));
        continue;
      }
      if (name === "href") {
        const href = safeLinkHref(value);
        href ? element.setAttribute(attribute.name, href) : element.removeAttribute(attribute.name);
        if (href) {
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noreferrer noopener");
        }
        continue;
      }
      if (name === "src" || name === "background") {
        const safe = safeEmailImageSrc(value, context);
        safe ? element.setAttribute(attribute.name, safe) : element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "srcset") {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName.toLowerCase() === "img") {
      element.setAttribute("loading", "lazy");
      element.setAttribute("referrerpolicy", "no-referrer");
      if (!element.getAttribute("alt")) {
        element.setAttribute("alt", "");
      }
    }
  }
  const headStyles = Array.from(doc.head?.querySelectorAll("style") || [])
    .map((style) => style.outerHTML)
    .join("\n");
  const body = doc.body || doc.documentElement;
  const bodyAttributes = body instanceof HTMLElement
    ? Array.from(body.attributes)
        .filter((attribute) => ["style", "class", "bgcolor", "text", "link", "vlink", "alink"].includes(attribute.name.toLowerCase()))
        .map((attribute) => `${attribute.name}="${escapeHtmlText(attribute.value)}"`)
        .join(" ")
    : "";
  const csp = [
    "default-src 'none'",
    `img-src 'self' ${origin} data: blob: https:`,
    "style-src 'unsafe-inline'",
    "font-src data: https:",
    "media-src data: blob: https:",
    "frame-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
  ].join("; ");
  return `<!doctype html>
<html>
<head>
<base href="${escapeHtmlText(origin)}/">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtmlText(csp)}">
<style>
html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
body { overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
${headStyles}
</head>
<body ${bodyAttributes}>${body.innerHTML}</body>
</html>`;
}

export function renderEmailFrame(rawHtml: string, context: EvidenceRenderContext) {
  const srcdoc = sanitizeEmailFrameDocument(rawHtml, context);
  return `<div class="rendered-email-frame-shell"><iframe class="rendered-email-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${escapeHtmlText(srcdoc)}"></iframe></div>`;
}

export function rewriteInlineAssetRefs(html: string, context: EvidenceRenderContext) {
  return rewriteInlineAssetRefsCore(html, context.assetUrlForReference);
}

export function renderEmailImage(element: Element, context: EvidenceRenderContext) {
  const src = safeEmailImageSrc(element.getAttribute("src") || "", context);
  const alt = normalizeRenderedText(element.getAttribute("alt") || element.getAttribute("title") || "");
  if (!src) {
    return alt ? `<span class="email-image-alt">${escapeHtmlText(alt)}</span>` : "";
  }
  return `<figure class="email-inline-image"><img src="${escapeHtmlText(src)}" alt="${escapeHtmlText(alt || "email image")}" loading="lazy" referrerpolicy="no-referrer" /><figcaption>${escapeHtmlText(alt)}</figcaption></figure>`;
}

export function renderEmailNode(node: Node, context: EvidenceRenderContext): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtmlText(normalizeRenderedText(node.textContent || ""));
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (
    isHiddenEmailElement(element) ||
    ["script", "style", "meta", "link", "head", "title", "noscript", "template", "svg", "iframe", "object", "embed"].includes(tag)
  ) {
    return "";
  }
  if (tag === "br") {
    return "<br />";
  }
  if (tag === "img") {
    return renderEmailImage(element, context);
  }
  const children = Array.from(element.childNodes)
    .map((child) => renderEmailNode(child, context))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+(<\/?(?:br|p|div|ul|ol|li|h4|blockquote|pre|figure)\b)/g, "$1")
    .replace(/(<\/(?:br|p|div|ul|ol|li|h4|blockquote|pre|figure)>)\s+/g, "$1")
    .trim();
  if (!children) {
    return "";
  }
  if (tag === "a") {
    const href = safeLinkHref(element.getAttribute("href") || "");
    return href
      ? `<a href="${escapeHtmlText(href)}" target="_blank" rel="noreferrer noopener">${children}</a>`
      : children;
  }
  if (tag === "li") {
    return `<li>${children}</li>`;
  }
  if (tag === "ul" || tag === "ol") {
    return `<${tag}>${children}</${tag}>`;
  }
  if (/^h[1-6]$/.test(tag)) {
    return `<h4>${children}</h4>`;
  }
  if (tag === "pre" || tag === "code") {
    return `<pre>${escapeHtmlText(element.textContent || "")}</pre>`;
  }
  if (tag === "blockquote") {
    return `<blockquote>${children}</blockquote>`;
  }
  if (tag === "figure") {
    return `<figure>${children}</figure>`;
  }
  if (["table", "tbody", "thead", "tfoot", "tr"].includes(tag)) {
    return `<div class="email-reader-group">${children}</div>`;
  }
  if (["td", "th", "div", "p", "section", "article", "main", "center"].includes(tag)) {
    return renderedHtmlHasBlocks(children)
      ? `<div class="email-reader-group">${children}</div>`
      : `<p>${children}</p>`;
  }
  return children;
}

export function renderReadableHtmlDocument(
  rawHtml: string,
  context: EvidenceRenderContext,
  options: { headers?: Array<[string, string]>; title?: string } = {},
) {
  const source = rewriteInlineAssetRefs(String(rawHtml || ""), context);
  const doc = new DOMParser().parseFromString(
    /<html[\s>]|<body[\s>]|<!doctype/i.test(source)
      ? source
      : `<!doctype html><html><body>${source}</body></html>`,
    "text/html",
  );
  const headers = options.headers || [];
  const importantHeaders = ["Subject", "From", "To", "Cc", "Date"];
  const headerHtml = `<dl class="rendered-email-headers">${importantHeaders
    .map((name) => {
      const value = emailHeaderValue(headers, name) || htmlMetaHeader(source, name);
      return value ? `<div><dt>${escapeHtmlText(name)}</dt><dd>${escapeHtmlText(value)}</dd></div>` : "";
    })
    .join("")}</dl>`;
  const body = doc.body || doc.documentElement;
  const content = Array.from(body.childNodes)
    .map((child) => renderEmailNode(child, context))
    .filter(Boolean)
    .join("")
    .trim();
  const fallback = plainTextToHtml(body.textContent || source);
  return `<article class="rendered-email rendered-email-reader">${headerHtml}<div class="email-reader-body">${content || fallback}</div></article>`;
}

export function emailToSafeHtml(rawText: string, context: EvidenceRenderContext) {
  const renderable = extractEmailRenderablePart(rawText);
  return (
    renderable.contentType === "text/html" || /<\/?[a-z][\s\S]*>/i.test(renderable.body)
      ? renderEmailFrame(renderable.body, context)
      : renderEmailFrame(`<pre>${escapeHtmlText(renderable.body)}</pre>`, context)
  );
}

export function renderEvidenceImageGallery(
  context: EvidenceRenderContext,
  excludedAssetIds = new Set<string>(),
) {
  const images = context.imageAssets().filter((asset) => !excludedAssetIds.has(String(asset.assetId || "")));
  if (images.length === 0) {
    return "";
  }
  return `<div class="rendered-image-grid">${images
    .map((asset) => {
      const src = asset.assetId ? context.assetUrlForAssetId(String(asset.assetId)) : "";
      return src
        ? `<figure><img src="${escapeHtmlText(src)}" alt="${escapeHtmlText(asset.title || asset.assetId || "image")}" loading="lazy" /><figcaption>${escapeHtmlText(asset.title || asset.caption || asset.assetId || "")}</figcaption></figure>`
        : "";
    })
    .join("")}</div>`;
}

export function embedEvidenceAssets(html: string, context: EvidenceRenderContext) {
  const gallery = renderEvidenceImageGallery(context, assetIdsEmbeddedInHtml(html));
  if (!gallery) {
    return html;
  }
  return `${html}<section class="rendered-inline-assets">${gallery}</section>`;
}

export function renderEvidenceReadableHtml(
  options: {
    text: string;
    kind: EvidenceReadableKindLabel;
  },
  context: EvidenceRenderContext,
) {
  if (!options.text && options.kind === "图片") {
    return renderEvidenceImageGallery(context) || plainTextToHtml("当前证据没有可展示的正文。");
  }
  if (options.kind === "EML") {
    return emailToSafeHtml(options.text, context);
  }
  if (options.kind === "HTML") {
    return renderEmailFrame(options.text, context);
  }
  if (options.kind === "Markdown") {
    return embedEvidenceAssets(markdownToSafeHtml(options.text), context);
  }
  return embedEvidenceAssets(plainTextToHtml(options.text || "当前证据没有可展示的正文。"), context);
}
