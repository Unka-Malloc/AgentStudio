import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${rawText}`);
  }
  return payload;
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-rule-authoring-"));
const featureProfilePath = path.join(userDataPath, "feature-profile.json");
await fs.writeFile(
  featureProfilePath,
  `${JSON.stringify({
    name: "knowledge-rule-authoring-verifier",
    enableFeatures: ["knowledge-distillation"]
  }, null, 2)}\n`,
  "utf8"
);
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal",
    featureProfile: featureProfilePath
  }
});
await installAuthenticatedFetch(server);

try {
  const generated = await fetchJson(`${server.url}/api/knowledge/rule-authoring/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "生成一个黄金规则：完全一样的知识直接跳过",
      modelEnabled: false
    })
  });
  assert.equal(generated.protocolVersion, "v0.0.1:knowledge:rule-authoring-1");
  assert.equal(generated.ok, true);
  assert.equal(generated.status, "pending_human_confirmation");
  assert.equal(generated.intent.needsRule, true);
  assert.equal(generated.template.templateId, "exact_duplicate_skip_existing");
  assert.equal(generated.gate.ok, true);
  assert.equal(generated.package.rules[0].action, "skip_existing");
  assert.equal(generated.package.status, "draft");
  assert.ok(generated.confirmation.packageId);
  assert.ok(generated.confirmation.version >= 1);

  const fetchedRun = await fetchJson(
    `${server.url}/api/knowledge/rule-authoring/runs/${encodeURIComponent(generated.runId)}`
  );
  assert.equal(fetchedRun.runId, generated.runId);
  assert.equal(fetchedRun.status, "pending_human_confirmation");

  const published = await fetchJson(
    `${server.url}/api/knowledge/golden-rules/${encodeURIComponent(generated.confirmation.packageId)}/publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: generated.confirmation.version
      })
    }
  );
  assert.equal(published.package.status, "active");
  assert.equal(published.package.packageId, generated.confirmation.packageId);

  const noRule = await fetchJson(`${server.url}/api/knowledge/rule-authoring/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "今天有哪些系统状态？",
      modelEnabled: false
    })
  });
  assert.equal(noRule.status, "no_rule_needed");
  assert.equal(noRule.intent.needsRule, false);
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("knowledge rule authoring verification passed.");
