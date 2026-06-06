import {
  createUploadSession,
  uploadSessionChunk,
} from "./upload-session-client";
import type { UploadedFilePayload, UploadSessionResponse } from "./types";

export type KnowledgeUploadFileDigest = {
  name: string;
  relativePath: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
};

export type KnowledgeUploadSessionProgress = {
  stage: "digest" | "session" | "upload";
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  message: string;
};

export type KnowledgeUploadSessionResult = {
  session: UploadSessionResponse;
  sessionId: string;
  fileDigests: KnowledgeUploadFileDigest[];
  totalBytes: number;
  manifestDigest: string;
  inputDigest: string;
  checkpointId: string;
};

export type CreateKnowledgeUploadSessionOptions = {
  checkpointPrefix?: string;
  checkpointMode?: string;
  checkpointSource?: string;
  chunkSize?: number;
  onProgress?: (progress: KnowledgeUploadSessionProgress) => void;
};

export type CreateKnowledgeUploadedFilesPayloadOptions = {
  onProgress?: (progress: KnowledgeUploadSessionProgress) => void;
};

export function knowledgeUploadFileRelativePath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

export function knowledgeUploadFileKey(file: File) {
  return `${knowledgeUploadFileRelativePath(file)}:${file.size}:${file.lastModified}`;
}

export function knowledgeUploadFingerprint(files: File[]) {
  return files.map(knowledgeUploadFileKey).join("|");
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emitProgress(
  onProgress: CreateKnowledgeUploadSessionOptions["onProgress"],
  progress: KnowledgeUploadSessionProgress,
) {
  if (typeof onProgress === "function") {
    onProgress(progress);
  }
}

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`无法读取文件：${file.name}`));
    reader.onload = () => {
      const value = String(reader.result || "");
      const commaIndex = value.indexOf(",");
      resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

export async function createKnowledgeUploadedFilesPayload(
  files: File[],
  options: CreateKnowledgeUploadedFilesPayloadOptions = {},
): Promise<UploadedFilePayload[]> {
  const filesToRead = [...files];
  const totalBytes = filesToRead.reduce((sum, file) => sum + file.size, 0);
  let processedBytes = 0;
  const output: UploadedFilePayload[] = [];

  for (const file of filesToRead) {
    emitProgress(options.onProgress, {
      stage: "digest",
      uploadedBytes: processedBytes,
      totalBytes,
      percent: totalBytes > 0 ? Math.round((processedBytes / totalBytes) * 100) : 100,
      message: `准备预览输入 ${output.length + 1}/${filesToRead.length}`,
    });
    const [sha256, dataBase64] = await Promise.all([
      sha256File(file),
      readFileBase64(file),
    ]);
    processedBytes += file.size;
    const percent = totalBytes > 0 ? Math.round((processedBytes / totalBytes) * 100) : 100;
    emitProgress(options.onProgress, {
      stage: "upload",
      uploadedBytes: processedBytes,
      totalBytes,
      percent,
      message: `准备预览输入 ${percent}%`,
    });
    output.push({
      name: file.name,
      relativePath: knowledgeUploadFileRelativePath(file),
      originalFileName: file.name,
      mediaType: file.type || "application/octet-stream",
      dataBase64,
      sha256,
      byteSize: file.size,
    });
  }

  return output;
}

export async function createKnowledgeUploadSession(
  files: File[],
  options: CreateKnowledgeUploadSessionOptions = {},
): Promise<KnowledgeUploadSessionResult> {
  const filesToUpload = [...files];
  const totalBytes = filesToUpload.reduce((sum, file) => sum + file.size, 0);
  emitProgress(options.onProgress, {
    stage: "digest",
    uploadedBytes: 0,
    totalBytes,
    percent: 0,
    message: "计算文件摘要...",
  });

  const fileDigests = await Promise.all(
    filesToUpload.map(async (file) => ({
      name: file.name,
      relativePath: knowledgeUploadFileRelativePath(file),
      mediaType: file.type || "application/octet-stream",
      byteSize: file.size,
      sha256: await sha256File(file),
    })),
  );
  const manifestDigest = await sha256Text(
    JSON.stringify(fileDigests.map((file) => [file.relativePath, file.sha256, file.byteSize])),
  );
  const inputDigest = await sha256Text("");
  const checkpointPrefix = options.checkpointPrefix || "knowledge-console";
  const checkpointMode = options.checkpointMode || "server-console";
  const checkpointSource = options.checkpointSource || "knowledge-console";
  const checkpointId = `${checkpointPrefix}:${manifestDigest}`;

  emitProgress(options.onProgress, {
    stage: "session",
    uploadedBytes: 0,
    totalBytes,
    percent: 0,
    message: "准备上传会话...",
  });

  const session = await createUploadSession({
    manifest: {
      manifestDigest,
      inputDigest,
      fileCount: filesToUpload.length,
      totalBytes,
      fileRecords: fileDigests.map((file) => ({
        label: file.name,
        relativePath: file.relativePath,
        sha256: file.sha256,
        byteSize: file.byteSize,
      })),
    },
    files: fileDigests,
    checkpoint: {
      checkpointId,
      parentCheckpointId: "",
      mode: checkpointMode,
      source: checkpointSource,
      inputDigest,
      manifestDigest,
    },
  });

  const chunkSize = Math.max(1, Number(options.chunkSize || 1024 * 1024));
  let uploadedBytes = (session.files || []).reduce(
    (sum, file) => sum + Math.min(Number(file.receivedBytes || 0), Number(file.byteSize || 0)),
    0,
  );

  for (let fileIndex = 0; fileIndex < filesToUpload.length; fileIndex += 1) {
    const file = filesToUpload[fileIndex];
    const sessionFile = (session.files || []).find((item) => Number(item.index ?? item.fileIndex) === fileIndex);
    let offset = Math.min(Number(sessionFile?.receivedBytes || 0), file.size);
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
      await uploadSessionChunk(session.sessionId, fileIndex, offset, chunk);
      offset += chunk.size;
      uploadedBytes += chunk.size;
      const percent = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100;
      emitProgress(options.onProgress, {
        stage: "upload",
        uploadedBytes,
        totalBytes,
        percent,
        message: `上传中 ${percent}%`,
      });
    }
  }

  return {
    session,
    sessionId: session.sessionId,
    fileDigests,
    totalBytes,
    manifestDigest,
    inputDigest,
    checkpointId,
  };
}
