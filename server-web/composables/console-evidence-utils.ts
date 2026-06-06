import type { KnowledgeAssetRef } from "../lib/types";
import { asRecord } from "./console-model-utils";

export function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function evidenceAssetHintValues(asset: KnowledgeAssetRef) {
  const record = asRecord(asset as unknown) || {};
  const metadata = asRecord(record.metadata) || {};
  const locator = asRecord(asset.sourceLocator) || {};
  return [
    asset.assetId,
    asset.title,
    asset.caption,
    asset.thumbnailAssetId,
    metadata.contentId,
    metadata.contentID,
    metadata["content-id"],
    metadata["Content-ID"],
    metadata.cid,
    metadata.CID,
    metadata.filename,
    metadata.fileName,
    metadata.name,
    metadata.path,
    metadata.originalRelativePath,
    locator.sourceId,
    locator.sourcePath,
    locator.originalRelativePath,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function normalizeCidToken(value: string) {
  const decoded = decodeURIComponentSafe(String(value || "").trim()).trim();
  return decoded
    .replace(/^cid:/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/^<|>$/g, "")
    .replace(/[?#].*$/g, "")
    .trim()
    .toLowerCase();
}

export function normalizeAssetReference(value: string) {
  const normalized = normalizeCidToken(value)
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return {
    full: normalized,
    basename: parts[parts.length - 1] || normalized,
  };
}

export function isImageAsset(asset: KnowledgeAssetRef) {
  const mediaType = String(asset.mediaType || "").toLowerCase();
  if (mediaType.startsWith("image/")) {
    return true;
  }
  return evidenceAssetHintValues(asset).some((hint) =>
    /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i.test(hint),
  );
}

export function resolveEvidenceAssetUrl(
  reference: string,
  images: KnowledgeAssetRef[],
  assetUrlForId: (assetId: string) => string,
) {
  const { full, basename } = normalizeAssetReference(reference);
  if (!full) {
    return "";
  }
  const exact = images.find((asset) =>
    evidenceAssetHintValues(asset).some((hint) => {
      const candidate = normalizeAssetReference(hint);
      return candidate.full === full || candidate.basename === full || candidate.basename === basename;
    }),
  );
  if (exact?.assetId) {
    return assetUrlForId(String(exact.assetId));
  }
  const loose = images.find((asset) =>
    evidenceAssetHintValues(asset).some((hint) => {
      const candidate = normalizeAssetReference(hint);
      return (
        candidate.full &&
        (candidate.full.includes(full) ||
          full.includes(candidate.full) ||
          candidate.basename.includes(basename) ||
          basename.includes(candidate.basename))
      );
    }),
  );
  if (loose?.assetId) {
    return assetUrlForId(String(loose.assetId));
  }
  return images.length === 1 && images[0]?.assetId
    ? assetUrlForId(String(images[0].assetId))
    : "";
}

export function safeEmailImageSrc(
  value: string,
  options: {
    origin: string;
    assetUrlForReference: (reference: string) => string;
  },
) {
  const raw = String(value || "").trim();
  const assetUrl = options.assetUrlForReference(raw);
  const src = (assetUrl || raw).trim();
  if (!src) {
    return "";
  }
  if (/^(\/api\/knowledge\/assets\/|data:image\/|blob:)/i.test(src)) {
    return src;
  }
  try {
    const url = new URL(src, options.origin);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const isTrackingHost =
      host.includes("click.") ||
      host.includes("track.") ||
      host.includes("tracking.") ||
      host.includes("doubleclick.") ||
      host.includes("analytics.");
    const isTrackingPath = /\/(ci0|track|pixel|open|beacon)\b/i.test(path);
    if (url.protocol === "https:" && !url.search && !isTrackingHost && !isTrackingPath) {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

export function sanitizeEmailCssUrls(value: string, safeImageSrc: (value: string) => string) {
  return String(value || "").replace(/url\(([^)]+)\)/gi, (_match, rawValue) => {
    const raw = String(rawValue || "").trim().replace(/^["']|["']$/g, "");
    const safe = safeImageSrc(raw);
    return safe ? `url("${safe.replace(/"/g, "%22")}")` : "none";
  });
}

export function rewriteInlineAssetRefs(html: string, assetUrlForReference: (reference: string) => string) {
  return String(html || "").replace(
    /\b(src|background)\s*=\s*(["'])([^"']+)\2/gi,
    (match, attr, quote, reference) => {
      const raw = String(reference || "");
      if (/^(https?:|data:image\/|blob:|\/api\/knowledge\/assets\/)/i.test(raw.trim())) {
        return match;
      }
      const url = assetUrlForReference(raw);
      return url ? `${attr}=${quote}${url}${quote}` : match;
    },
  );
}

export function normalizeRenderedText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function renderedHtmlHasBlocks(value: string) {
  return /<(p|div|section|article|ul|ol|li|table|blockquote|h[1-6]|pre|figure)\b/i.test(value);
}

export function isHiddenEmailElement(element: Element) {
  const style = String(element.getAttribute("style") || "").toLowerCase();
  return (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    /display\s*:\s*none/.test(style) ||
    /visibility\s*:\s*hidden/.test(style) ||
    /opacity\s*:\s*0/.test(style) ||
    /font-size\s*:\s*0/.test(style) ||
    /max-height\s*:\s*0/.test(style)
  );
}

export function assetIdsEmbeddedInHtml(html: string) {
  const ids = new Set<string>();
  for (const match of String(html || "").matchAll(/\/api\/knowledge\/assets\/([^"')\s<]+)/g)) {
    ids.add(decodeURIComponentSafe(match[1] || ""));
  }
  return ids;
}
