import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../../security/client-strings.mjs";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"]
]);

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

export function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function parseBooleanFlag(value) {
  return value === "1" || value === "true" || value === "yes";
}

export function parseEntityTypes(searchParams) {
  return searchParams
    .getAll("entityType")
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function contentDispositionFileName(value) {
  const fallback = String(value || "download.bin")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/[\\/:*?<>|";\r\n]+/g, "_")
    .replace(/_+/g, "_")
    .trim();
  return fallback || "download.bin";
}

function encodeRfc5987Value(value) {
  return encodeURIComponent(String(value || "download.bin").replace(/[\r\n]/g, "_"))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function contentDispositionHeader(disposition = "attachment", fileName = "download.bin") {
  const safeDisposition = /^[A-Za-z][A-Za-z0-9!#$&+.^_`|~-]*$/.test(String(disposition || ""))
    ? String(disposition)
    : "attachment";
  const rawFileName = String(fileName || "download.bin").replace(/[\r\n]/g, "_");
  return `${safeDisposition}; filename="${contentDispositionFileName(rawFileName)}"; filename*=UTF-8''${encodeRfc5987Value(rawFileName)}`;
}

const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024; // 32 MB

export async function readRequestBody(request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      // Drain and discard so the socket stays clean.
      request.resume();
      const err = new Error(`请求体过大，最大允许 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export async function readJsonBody(request) {
  const raw = await readRequestBody(request);
  if (raw.length === 0) {
    return {};
  }

  return JSON.parse(raw.toString("utf8"));
}

export async function serveStaticFile(response, distPath, pathname) {
  if (!distPath) {
    return false;
  }

  const normalizedPath = pathname === "/" || pathname === "/console" ? "/index.html" : pathname;
  // M-5: use resolveWithin for reliable path-containment check instead of regex
  let filePath;
  try {
    const relative = path.normalize(normalizedPath).replace(/^[/\\]+/, "");
    filePath = resolveWithin(distPath, relative);
  } catch {
    // resolveWithin throws on path traversal attempts — treat as not found
    return false;
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error("Not a file");
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES.get(extension) || "application/octet-stream";
    const buffer = await fs.readFile(filePath);

    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=31536000"
    });
    response.end(buffer);
    return true;
  } catch {
    return false;
  }
}

export function defaultAdvertisedHost(host) {
  if (!host || host === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (host === "::") {
    return "::1";
  }

  return host;
}

export function formatUrlHost(host) {
  return host.includes(":") ? `[${host}]` : host;
}
