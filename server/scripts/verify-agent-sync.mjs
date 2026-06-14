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
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function hasTopic(result, topic) {
  return [...(result.events || []), ...(result.snapshots || [])].some(
    (event) => event.topic === topic
  );
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-sync-"));
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const config = await fetchJson(`${server.url}/api/agent-sync/config`);
  assert.equal(config.status, 200);
  assert.equal(config.payload.config.enabled, true);
  assert.equal(
    config.payload.config.topics.find((item) => item.topic === "agent.sync.answer")?.enabled,
    true
  );
  assert.equal(
    config.payload.config.topics.find((item) => item.topic === "agent.sync.risk")?.enabled,
    false
  );

  const grant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "sync-agent",
      scopes: ["agent_sync:publish"]
    })
  });
  assert.equal(grant.status, 201);
  assert.ok(grant.payload.token);

  const deniedWithoutToken = await fetchJson(`${server.url}/api/agent-sync/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: "answer",
      payload: { text: "should not publish" }
    })
  });
  assert.equal(deniedWithoutToken.status, 401);

  const wrongScopeGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "sync-wrong-scope",
      scopes: ["knowledge:read"]
    })
  });
  assert.equal(wrongScopeGrant.status, 201);
  assert.ok(wrongScopeGrant.payload.token);

  const deniedWrongScope = await fetchJson(`${server.url}/api/agent-sync/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${wrongScopeGrant.payload.token}`
    },
    body: JSON.stringify({
      topic: "answer",
      payload: { text: "wrong grant scope" }
    })
  });
  assert.equal(deniedWrongScope.status, 403);
  assert.equal(deniedWrongScope.payload.error.code, "missing_scopes");

  const published = await fetchJson(`${server.url}/api/agent-sync/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grant.payload.token}`
    },
    body: JSON.stringify({
      topic: "answer",
      type: "agent_sync.answer.delta",
      agentName: "planner",
      sessionId: "session-1",
      userId: "user-1",
      projectId: "project-1",
      payload: {
        text: "sync this answer"
      }
    })
  });
  assert.equal(published.status, 200);
  assert.equal(published.payload.event.topic, "agent.sync.answer");
  assert.equal(published.payload.event.payload.payload.text, "sync this answer");

  const syncEvents = await fetchJson(
    `${server.url}/api/agent-sync/events?topic=answer&includeSnapshot=1`
  );
  assert.equal(syncEvents.status, 200);
  assert.equal(hasTopic(syncEvents.payload, "agent.sync.answer"), true);

  const generalEvents = await fetchJson(
    `${server.url}/api/events?topic=agent.sync.answer&includeSnapshot=1`
  );
  assert.equal(generalEvents.status, 200);
  assert.equal(hasTopic(generalEvents.payload, "agent.sync.answer"), true);

  const disabledPublish = await fetchJson(`${server.url}/api/agent-sync/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grant.payload.token}`
    },
    body: JSON.stringify({
      topic: "risk",
      payload: { text: "do not sync risk by default" }
    })
  });
  assert.equal(disabledPublish.status, 403);

  const disabledConfig = await fetchJson(`${server.url}/api/agent-sync/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      topics: [
        { topic: "answer", enabled: false, retain: true },
        { topic: "risk", enabled: false, retain: false }
      ]
    })
  });
  assert.equal(disabledConfig.status, 200);
  assert.equal(
    disabledConfig.payload.config.topics.find((item) => item.topic === "agent.sync.answer")
      ?.enabled,
    false
  );

  const filteredSyncEvents = await fetchJson(
    `${server.url}/api/agent-sync/events?topic=answer&includeSnapshot=1`
  );
  assert.equal(filteredSyncEvents.status, 200);
  assert.equal(hasTopic(filteredSyncEvents.payload, "agent.sync.answer"), false);

  const filteredGeneralEvents = await fetchJson(
    `${server.url}/api/events?topic=agent.sync.answer&includeSnapshot=1`
  );
  assert.equal(filteredGeneralEvents.status, 200);
  assert.equal(hasTopic(filteredGeneralEvents.payload, "agent.sync.answer"), false);

  console.log("Agent sync verification passed.");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
