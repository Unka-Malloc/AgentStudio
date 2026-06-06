export type UploadSessionResponse = {
  sessionId: string;
  checkpointId?: string;
  checkpointTreeId?: string;
  manifestDigest?: string;
  inputDigest?: string;
  status: string;
  receivedBytes?: number;
  totalBytes?: number;
  files?: Array<{
    index?: number;
    fileIndex?: number;
    name: string;
    relativePath?: string;
    byteSize: number;
    receivedBytes: number;
    completed?: boolean;
    complete?: boolean;
  }>;
};
