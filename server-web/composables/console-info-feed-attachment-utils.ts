import type { InfoFeedAttachment } from "../types/app";

export function isReadableInfoFeedAttachment(file: File) {
  const name = file.name.toLowerCase();
  const textExtensions = [
    ".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".xml", ".html", ".htm", ".eml",
    ".log", ".yaml", ".yml", ".toml", ".ini", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue",
    ".py", ".java", ".go", ".rs", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php", ".rb", ".swift",
    ".kt", ".kts", ".sh", ".bash", ".zsh", ".fish", ".sql", ".css", ".scss", ".less",
  ];
  return file.type.startsWith("text/") ||
    file.type === "message/rfc822" ||
    textExtensions.some((extension) => name.endsWith(extension));
}

export function compactInfoFeedAttachment(attachment: InfoFeedAttachment): InfoFeedAttachment {
  return {
    ...attachment,
    text: String(attachment.text || "").slice(0, 4000),
    error: String(attachment.error || "").slice(0, 1000),
  };
}

export function snapshotInfoFeedAttachments(attachments: InfoFeedAttachment[]) {
  return attachments.map(compactInfoFeedAttachment);
}
