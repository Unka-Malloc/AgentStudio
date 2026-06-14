import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const execFileAsync = promisify(execFile);

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${rawText}`);
  }
  return payload;
}

async function waitForJob(baseUrl, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await fetchJson(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === "completed") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(job.error || "Job failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Job did not complete in time.");
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-mm-"));
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const createdJob = await fetchJson(`${server.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: [
        "# Alpha Portal 路线图",
        "",
        "本季度 Alpha Portal 的路线图包括账户工作台、支付通知、图文知识库召回。",
        "产品截图 roadmap.png 是同一事项的视觉证据。"
      ].join("\n"),
      uploadedFiles: [
        {
          name: "roadmap.png",
          relativePath: "assets/roadmap.png",
          mediaType: "image/png",
          dataBase64: ONE_PIXEL_PNG_BASE64,
          byteSize: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64").length
        }
      ],
      settings: {
        knowledgeCoreEnabled: true
      }
    })
  });

  await waitForJob(server.url, createdJob.id);

  const capabilities = await fetchJson(`${server.url}/api/knowledge/capabilities`);
  assert.equal(capabilities.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(capabilities.modalities.text, true);
  assert.equal(capabilities.modalities.image, true);

  const health = await fetchJson(`${server.url}/api/knowledge/health`);
  assert.equal(health.ok, true);
  assert.ok(health.counts.documents >= 2);
  assert.ok(health.counts.blocks >= 2);
  assert.ok(health.counts.assets >= 1);

  const maintenance = await fetchJson(`${server.url}/api/knowledge/maintenance`);
  assert.ok(maintenance.retrieval.topK > 0);
  const updatedMaintenance = await fetchJson(`${server.url}/api/knowledge/maintenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      retrieval: {
        topK: 12
      }
    })
  });
  assert.equal(updatedMaintenance.retrieval.topK, 12);

  const reindex = await fetchJson(`${server.url}/api/knowledge/reindex`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      confirm: true
    })
  });
  assert.equal(reindex.status, "completed");
  assert.ok(reindex.blockEmbeddings >= 1);

  for (const taskType of [
    "validate_assets",
    "repair_missing_thumbnails",
    "delete_orphan_objects",
    "compare_retrieval_profiles",
    "validate_quality",
    "reembed_by_model_version"
  ]) {
    const maintenanceRun = await fetchJson(`${server.url}/api/knowledge/maintenance/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        taskType,
        confirm: ["delete_orphan_objects", "reembed_by_model_version"].includes(taskType),
        queries: ["roadmap 路线图"],
        modelVersion: taskType === "reembed_by_model_version" ? "verify-v2" : undefined
      })
    });
    assert.equal(maintenanceRun.status, "completed");
    assert.equal(maintenanceRun.taskType, taskType);
  }

  const search = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: "roadmap 路线图",
      filters: {
        modality: "text"
      },
      limit: 5
    })
  });
  assert.equal(search.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(search.modalityPolicy.mode, "multimodal");
  assert.equal(search.modalityPolicy.filtersAllowed, false);
  assert.ok(search.items.length > 0);
  assert.ok(search.items.some((item) => item.modalities.includes("image")));

  const evidenceId = search.items.find((item) => item.modalities.includes("image")).evidenceId;
  const evidence = await fetchJson(
    `${server.url}/api/knowledge/evidence/${encodeURIComponent(evidenceId)}`
  );
  assert.equal(evidence.evidenceId, evidenceId);
  assert.ok(evidence.payload.assets.length >= 1);
  const assetId = evidence.payload.assets[0].assetId;
  const assetResponse = await fetch(`${server.url}/api/knowledge/assets/${encodeURIComponent(assetId)}`);
  assert.equal(assetResponse.ok, true);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");
  assert.ok((await assetResponse.arrayBuffer()).byteLength > 0);

  const rendered = await fetchJson(`${server.url}/api/knowledge/render/markdown`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      evidenceId,
      format: "markdown"
    })
  });
  assert.equal(rendered.contentType, "text/markdown; charset=utf-8");
  assert.match(rendered.markdown, /pact_knowledge:/);
  const encodedAssetId = encodeURIComponent(assetId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(rendered.markdown, new RegExp(`/api/knowledge/assets/${encodedAssetId}`));

  const rpcHealth = await fetchJson(`${server.url}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "health",
      method: "knowledge.health",
      params: {}
    })
  });
  assert.equal(rpcHealth.result.ok, true);

  const cliResult = await execFileAsync(
    process.execPath,
    [
      "server/scripts/pact.mjs",
      "knowledge",
      "search",
      "--server-url",
      server.url,
      "--query",
      "roadmap 路线图",
      "--limit",
      "3",
      "--format",
      "markdown"
    ],
    {
      cwd: path.resolve(new URL("../..", import.meta.url).pathname)
    }
  );
  const cliPayload = JSON.parse(cliResult.stdout);
  assert.equal(cliPayload.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.ok(cliPayload.items.length > 0);
  assert.match(cliPayload.rendered.markdown, /pact_knowledge:/);

  const deleted = await fetchJson(`${server.url}/api/jobs/${encodeURIComponent(createdJob.id)}`, {
    method: "DELETE"
  });
  assert.equal(deleted.ok, true);
  const healthAfterDelete = await fetchJson(`${server.url}/api/knowledge/health`);
  assert.equal(healthAfterDelete.counts.documents, 0);
  assert.equal(healthAfterDelete.counts.assets, 0);
} finally {
  await server.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Knowledge multimodal verification passed.");
