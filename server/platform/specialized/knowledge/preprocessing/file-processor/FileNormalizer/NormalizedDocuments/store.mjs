import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export const NORMALIZED_DOCUMENTS_DIR = "normalized-documents";
export const NORMALIZED_MANIFEST_FILE = "manifest.json";

export function getJobDirectory(userDataPath, jobId) {
  return path.join(userDataPath, "jobs", String(jobId || ""));
}

export function getNormalizedDocumentsDirectory(userDataPath, jobId) {
  return path.join(getJobDirectory(userDataPath, jobId), NORMALIZED_DOCUMENTS_DIR);
}

export function getNormalizedManifestPath(userDataPath, jobId) {
  return path.join(
    getNormalizedDocumentsDirectory(userDataPath, jobId),
    NORMALIZED_MANIFEST_FILE
  );
}

export async function loadNormalizedDocumentsManifest(userDataPath, jobId) {
  const manifestPath = getNormalizedManifestPath(userDataPath, jobId);
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

export function listNormalizedManifestEntries(manifest = {}) {
  return [
    ...(Array.isArray(manifest.documents) ? manifest.documents : []),
    ...(Array.isArray(manifest.sourceMaterials) ? manifest.sourceMaterials : [])
  ];
}

export function resolveNormalizedDocumentEntry(manifest, documentId) {
  const normalizedId = String(documentId || "");
  return (
    listNormalizedManifestEntries(manifest).find(
      (entry) => String(entry.documentId || "") === normalizedId
    ) || null
  );
}

export function resolveNormalizedDocumentPath(userDataPath, jobId, entry) {
  const rootPath = getNormalizedDocumentsDirectory(userDataPath, jobId);
  const relativePath = String(entry?.relativePath || "");
  const absolutePath = path.resolve(rootPath, relativePath);
  const normalizedRoot = path.resolve(rootPath);
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("归一化文档路径越界。");
  }
  const realRoot = fsSync.realpathSync.native(normalizedRoot);
  const realTarget = fsSync.realpathSync.native(absolutePath);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error("归一化文档路径越界。");
  }
  return absolutePath;
}

export function normalizedContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (extension === ".ppt") {
    return "application/vnd.ms-powerpoint";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  if (extension === ".html" || extension === ".htm") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".yaml" || extension === ".yml") {
    return "application/yaml; charset=utf-8";
  }
  return "application/octet-stream";
}
