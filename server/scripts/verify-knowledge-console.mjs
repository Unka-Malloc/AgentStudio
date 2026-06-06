import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCheckpointTree } from "../platform/common/data-structure/checkpoint-tree-store.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { readInitialOwnerCredentials } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${rawText}`);
  }
  return payload;
}

function cookieHeaderFrom(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response.headers.get("set-cookie") || "")
          .split(/,(?=\s*pact_)/)
          .filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return {
    cookie: cookieHeaderFrom(response),
    csrf: payload.csrfToken
  };
}

function authOptions(auth, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      Cookie: auth.cookie,
      ...(!["GET", "HEAD", "OPTIONS"].includes(method)
        ? { "x-pact-csrf": auth.csrf }
        : {})
    }
  };
}

async function waitForJob(baseUrl, jobId, auth) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await fetchJson(
      `${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`,
      authOptions(auth)
    );
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

async function waitForSourceIndex(baseUrl, sourceId, auth) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await fetchJson(`${baseUrl}/api/knowledge/sources`, authOptions(auth));
    const source = (state.sources || []).find((item) => item.sourceId === sourceId);
    if (source?.indexStatus === "indexed") {
      return source;
    }
    if (source?.indexStatus === "failed") {
      throw new Error(source.lastIndexError || "Source index failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Source index did not complete in time.");
}

function buildUploadedText(name, relativePath, text) {
  const buffer = Buffer.from(text, "utf8");
  return {
    name,
    relativePath,
    mediaType: "text/plain",
    dataBase64: buffer.toString("base64"),
    byteSize: buffer.length
  };
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-console-"));
const mockDocumentParserModulePath = fileURLToPath(
  new URL("../../tests/server/mock-structured-document-parser.mjs", import.meta.url)
);
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal",
    mountModules: {
      documentParser: mockDocumentParserModulePath
    }
  }
});

try {
  const ownerCredentials = await readInitialOwnerCredentials(server);
  const auth = await login(server.url, ownerCredentials.username, ownerCredentials.password);

  const consoleState = await fetchJson(
    `${server.url}/api/knowledge/console`,
    authOptions(auth)
  );
  assert.equal(consoleState.available, true);
  assert.ok(consoleState.health);
  assert.ok(consoleState.capabilities);

  const schema = await fetchJson(
    `${server.url}/api/knowledge/config-schema`,
    authOptions(auth)
  );
  assert.equal(schema.schemaVersion, 1);
  assert.ok(schema.groups.some((group) => group.id === "retrieval"));
  assert.ok(
    schema.groups
      .find((group) => group.id === "retrieval")
      ?.fields.some((field) => field.name === "retrieval.recencyHalfLifeDays")
  );
  assert.ok(schema.maintenanceTasks.some((task) => task.id === "reindex"));

  const createdJob = await fetchJson(
    `${server.url}/api/jobs`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        uploadedFiles: [
          buildUploadedText(
            "console-kb-note.txt",
            "notes/console-kb-note.txt",
            [
              "Pact knowledge console verification note.",
              "The console can search evidence packs, render markdown, and inspect normalized DOCX output.",
              "The retrieval phrase is console evidence markdown operations."
            ].join("\n")
          )
        ],
        settings: {}
      })
    })
  );
  await waitForJob(server.url, createdJob.id, auth);

  const manifest = await fetchJson(
    `${server.url}/api/jobs/${encodeURIComponent(createdJob.id)}/normalized-documents`,
    authOptions(auth)
  );
  assert.ok(Array.isArray(manifest.documents));
  assert.ok(manifest.documents.length >= 1);
  assert.equal(
    [...manifest.documents, ...manifest.sourceMaterials].some((entry) =>
      String(entry.relativePath || "").toLowerCase().endsWith(".md")
    ),
    false
  );

  const afterIngest = await fetchJson(
    `${server.url}/api/knowledge/console`,
    authOptions(auth)
  );
  assert.ok(afterIngest.health.counts.documents >= 1);
  assert.ok(afterIngest.health.counts.blocks >= 1);

  const sourceRoot = path.join(userDataPath, "source-conflict-fixture");
  await fs.mkdir(sourceRoot, { recursive: true });
  const sourceFilePath = path.join(sourceRoot, "policy.txt");
  await fs.writeFile(
    sourceFilePath,
    "Original directory source with console evidence markdown operations.",
    "utf8"
  );
  await fs.writeFile(
    path.join(sourceRoot, "workspace-shortcut.gdoc"),
    JSON.stringify({ url: "https://docs.google.com/document/d/placeholder" }),
    "utf8"
  );
  const sourceCreated = await fetchJson(
    `${server.url}/api/knowledge/sources`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pact-safety-confirm": "true"
      },
      body: JSON.stringify({
        label: "Conflict Fixture",
        directoryPath: sourceRoot,
        recursive: true,
        autoSync: false,
        enabled: true,
        runNow: true
      })
    })
  );
	  assert.equal(sourceCreated.source.lastHydrationFailedCount, 1);
	  assert.equal(sourceCreated.source.lastHydratedFileCount, 1);
	  assert.equal(sourceCreated.job.checkpointReceipt.hydration.failedCount, 1);
		  assert.ok(sourceCreated.job.checkpointReceipt.fileManifestPath);
		  assert.match(sourceCreated.source.lastSyncCheckpointTreeId || "", /^checkpoint_tree_[a-f0-9]{32}$/);
		  assert.match(sourceCreated.job.checkpointTreeId || "", /^checkpoint_tree_[a-f0-9]{32}$/);
		  const indexedSource = await waitForSourceIndex(server.url, sourceCreated.source.sourceId, auth);
		  assert.equal(indexedSource.indexStatus, "indexed");
		  assert.ok(indexedSource.lastIndexedFileCount >= 1);
		  assert.match(indexedSource.lastIndexCheckpointTreeId || "", /^checkpoint_tree_[a-f0-9]{32}$/);
		  const sourceSyncTree = await loadCheckpointTree({
		    userDataPath,
		    treeId: sourceCreated.source.lastSyncCheckpointTreeId
		  });
		  assert.equal(sourceSyncTree?.status, "completed");
		  assert.ok(sourceSyncTree?.nodes?.["create-parse-job"]);
		  const sourceIndexTree = await loadCheckpointTree({
		    userDataPath,
		    treeId: indexedSource.lastIndexCheckpointTreeId
		  });
		  assert.equal(sourceIndexTree?.status, "completed");
		  assert.ok(sourceIndexTree?.nodes?.["write-inverted-index"]);
		  const rawSourceSearch = await fetchJson(
	    `${server.url}/api/knowledge/search`,
	    authOptions(auth, {
	      method: "POST",
	      headers: {
	        "Content-Type": "application/json"
	      },
	      body: JSON.stringify({
	        query: "Original directory source",
	        sourceSearch: true,
	        limit: 5
	      })
	    })
		  );
	  assert.ok(rawSourceSearch.items.length >= 1);
		  assert.equal(rawSourceSearch.explain?.invertedIndex?.used, true);
		  assert.match(rawSourceSearch.explain?.candidateSearch || "", /sqlite-inverted-index/);
		  await waitForJob(server.url, sourceCreated.job.id, auth);
		  const sourceJobTree = await loadCheckpointTree({
		    userDataPath,
		    treeId: sourceCreated.job.checkpointTreeId
		  });
		  assert.equal(sourceJobTree?.status, "completed");
		  assert.ok(sourceJobTree?.nodes?.["worker-run"]);

  const hydratedCommandRoot = path.join(userDataPath, "source-hydration-command-fixture");
  const hydrateScriptPath = path.join(userDataPath, "hydrate-command.mjs");
  await fs.mkdir(hydratedCommandRoot, { recursive: true });
  await fs.writeFile(
    path.join(hydratedCommandRoot, "remote-doc.gdoc"),
    JSON.stringify({ url: "https://docs.google.com/document/d/exportable" }),
    "utf8"
  );
  await fs.writeFile(
    hydrateScriptPath,
    [
      "import fs from 'node:fs/promises';",
      "import path from 'node:path';",
      "const target = process.argv[2];",
      "await fs.mkdir(path.dirname(target), { recursive: true });",
      "await fs.writeFile(target, 'Hydrated command document for knowledge source placeholder parsing.', 'utf8');"
    ].join("\n"),
    "utf8"
  );
  const commandHydratedSource = await fetchJson(
    `${server.url}/api/knowledge/sources`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pact-safety-confirm": "true"
      },
      body: JSON.stringify({
        label: "Hydration Command Fixture",
        directoryPath: hydratedCommandRoot,
        recursive: true,
        autoSync: false,
        enabled: true,
        hydrationEnabled: true,
        hydrationCommand: process.execPath,
        hydrationArgs: [hydrateScriptPath, "{{targetPath}}"],
        runNow: true
      })
    })
  );
  assert.equal(commandHydratedSource.source.lastHydrationFailedCount, 0);
  assert.equal(commandHydratedSource.source.lastHydratedFileCount, 1);
  assert.equal(commandHydratedSource.job.checkpointReceipt.hydration.commandHydratedCount, 1);
  await waitForJob(server.url, commandHydratedSource.job.id, auth);

  await fs.writeFile(
    sourceFilePath,
    "Updated directory source with console evidence markdown operations and conflict replacement marker.",
    "utf8"
  );
  const sourceRefreshed = await fetchJson(
    `${server.url}/api/knowledge/sources/${encodeURIComponent(sourceCreated.source.sourceId)}/refresh`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        force: true
      })
    })
  );
  await waitForJob(server.url, sourceRefreshed.job.id, auth);

  const reviewItems = await fetchJson(
    `${server.url}/api/knowledge/review-items?status=pending`,
    authOptions(auth)
  );
  const ingestConflict = reviewItems.items.find(
    (item) => item.reason === "source_path_content_conflict"
  );
  assert.ok(ingestConflict);
  assert.equal(ingestConflict.source, "knowledge-core");

  const resolvedConflict = await fetchJson(
    `${server.url}/api/knowledge/review-items/${encodeURIComponent(ingestConflict.reviewId)}/resolve`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        resolution: "replace"
      })
    })
  );
  assert.equal(resolvedConflict.status, "resolved");

  const search = await fetchJson(
    `${server.url}/api/knowledge/search`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: "console evidence markdown operations",
        limit: 5
      })
    })
  );
  assert.ok(search.items.length > 0);
  assert.equal(search.agentMessage, undefined);
  const evidenceId = search.items[0].evidenceId;
  assert.ok(evidenceId);

  const evidence = await fetchJson(
    `${server.url}/api/knowledge/evidence/${encodeURIComponent(evidenceId)}`,
    authOptions(auth)
  );
  assert.equal(evidence.evidenceId, evidenceId);
  assert.ok(evidence.payload || evidence.text || evidence.block);

  const rendered = await fetchJson(
    `${server.url}/api/knowledge/render/markdown`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        evidenceId,
        format: "markdown"
      })
    })
  );
  assert.match(rendered.markdown, /pact_knowledge|console evidence markdown/i);

  const maintenance = await fetchJson(
    `${server.url}/api/knowledge/maintenance`,
    authOptions(auth)
  );
  assert.ok(maintenance.retrieval.topK > 0);
  assert.equal(maintenance.retrieval.recencyHalfLifeDays, 45);
  const updated = await fetchJson(
    `${server.url}/api/knowledge/maintenance`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        confirm: true,
        value: {
          retrieval: {
            topK: 7,
            recencyHalfLifeDays: 14,
            recencyWeight: 0.12
          }
        }
      })
    })
  );
  assert.equal(updated.retrieval.topK, 7);
  assert.equal(updated.retrieval.recencyHalfLifeDays, 14);
  assert.equal(updated.retrieval.recencyWeight, 0.12);

  const run = await fetchJson(
    `${server.url}/api/knowledge/maintenance/run`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        taskType: "validate_quality"
      })
    })
  );
  assert.equal(run.status, "completed");

  const reindex = await fetchJson(
    `${server.url}/api/knowledge/reindex`,
    authOptions(auth, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        confirm: true
      })
    })
  );
  assert.equal(reindex.status, "completed");

  console.log("Knowledge console verification passed.");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
