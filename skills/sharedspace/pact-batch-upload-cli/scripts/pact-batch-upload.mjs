#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DEFAULT_CHUNK_SIZE = 1024 * 1024;

function parseArgs(argv) {
  const args = { input: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args.input.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else if (key === "input") {
      args.input.push(next);
      index += 1;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  pact-batch-upload.mjs --server-url http://127.0.0.1:8787 --input file-or-folder [--input more] [--wait] [--output-result result.json]",
    "",
    "Options:",
    "  --checkpoint-id ID   Defaults to a digest of the manifest",
    "  --chunk-size BYTES   Defaults to 1048576",
    "  --settings JSON      Inline job settings JSON"
  ].join("\n");
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function walkInput(inputPath, rootPath = inputPath) {
  const stats = await fsp.stat(inputPath);
  if (stats.isDirectory()) {
    const names = await fsp.readdir(inputPath);
    const nested = [];
    for (const name of names) {
      if (name === ".DS_Store") {
        continue;
      }
      nested.push(...(await walkInput(path.join(inputPath, name), rootPath)));
    }
    return nested;
  }
  if (!stats.isFile()) {
    return [];
  }
  return [
    {
      absolutePath: path.resolve(inputPath),
      relativePath: path.relative(path.dirname(rootPath), inputPath).replace(/\\/g, "/"),
      byteSize: stats.size
    }
  ];
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function digestManifest(files) {
  return createHash("sha256")
    .update(JSON.stringify(files.map((file) => [file.relativePath, file.sha256, file.byteSize])))
    .digest("hex");
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${response.status} ${body}`);
  }
  return body.trim() ? JSON.parse(body) : {};
}

async function uploadFileChunks({ baseUrl, sessionId, file, fileIndex, chunkSize, receivedBytes }) {
  let offset = Number(receivedBytes || 0);
  const handle = await fsp.open(file.absolutePath, "r");
  try {
    while (offset < file.byteSize) {
      const length = Math.min(chunkSize, file.byteSize - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const response = await fetch(
        `${baseUrl}/api/upload-sessions/${encodeURIComponent(sessionId)}/files/${fileIndex}?offset=${offset}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            accept: "application/json"
          },
          body: buffer
        }
      );
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`chunk upload failed: ${response.status} ${text}`);
      }
      const session = JSON.parse(text);
      const remoteFile = session.files.find((item) => item.index === fileIndex);
      offset = Number(remoteFile?.receivedBytes || offset + length);
      process.stderr.write(`uploaded ${file.relativePath}: ${offset}/${file.byteSize}\n`);
    }
  } finally {
    await handle.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args["server-url"] || args.input.length === 0) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const baseUrl = normalizeBaseUrl(args["server-url"]);
  const chunkSize = Math.max(64 * 1024, Number(args["chunk-size"] || DEFAULT_CHUNK_SIZE));
  const allFiles = [];
  for (const input of args.input) {
    allFiles.push(...(await walkInput(path.resolve(String(input)))));
  }
  if (allFiles.length === 0) {
    throw new Error("No files found");
  }

  for (const file of allFiles) {
    file.name = path.basename(file.relativePath);
    file.mediaType = "application/octet-stream";
    file.sha256 = await sha256File(file.absolutePath);
  }
  const manifestDigest = digestManifest(allFiles);
  const checkpointId = String(args["checkpoint-id"] || `skill-${manifestDigest.slice(0, 24)}`);

  let session = await jsonRequest(`${baseUrl}/api/upload-sessions`, {
    method: "POST",
    body: JSON.stringify({
      checkpoint: { checkpointId, mode: "skill-cli" },
      manifest: { manifestDigest, inputDigest: manifestDigest },
      files: allFiles.map(({ name, relativePath, mediaType, sha256, byteSize }) => ({
        name,
        relativePath,
        mediaType,
        sha256,
        byteSize
      }))
    })
  });

  for (const file of allFiles) {
    const remote = session.files.find((item) => item.relativePath === file.relativePath);
    if (!remote) {
      throw new Error(`Remote session is missing ${file.relativePath}`);
    }
    if (!remote.completed) {
      await uploadFileChunks({
        baseUrl,
        sessionId: session.sessionId,
        file,
        fileIndex: remote.index,
        chunkSize,
        receivedBytes: remote.receivedBytes
      });
      session = await jsonRequest(`${baseUrl}/api/upload-sessions/${encodeURIComponent(session.sessionId)}`);
    }
  }

  const settings = args.settings ? JSON.parse(String(args.settings)) : {};
  const job = await jsonRequest(`${baseUrl}/api/jobs`, {
    method: "POST",
    body: JSON.stringify({
      checkpoint: { checkpointId, mode: "skill-cli" },
      uploadSessionId: session.sessionId,
      uploadedFiles: [],
      settings
    })
  });
  console.log(JSON.stringify(job, null, 2));

  if (!args.wait) {
    return;
  }

  let current = job;
  while (!["completed", "failed"].includes(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    current = await jsonRequest(`${baseUrl}/api/jobs/${encodeURIComponent(job.id)}`);
    process.stderr.write(`${current.status} ${current.progressPercent || 0}% ${current.stage || ""}\n`);
  }
  if (current.status === "failed") {
    throw new Error(current.error || "Job failed");
  }

  const result = await jsonRequest(`${baseUrl}/api/jobs/${encodeURIComponent(job.id)}/result`);
  if (args["output-result"]) {
    const outputPath = path.resolve(String(args["output-result"]));
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    process.stderr.write(`result: ${outputPath}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
