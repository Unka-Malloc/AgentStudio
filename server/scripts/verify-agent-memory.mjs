import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENT_MEMORY_PROTOCOL_VERSION,
  createAgentMemory
} from "../platform/specialized/agent/agent-memory/index.mjs";
import { createContextRuntime } from "../platform/specialized/agent/agent-context/interface/index.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-memory-"));

function message(index) {
  return {
    id: `msg-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    apiRoundId: `round-${Math.floor(index / 2)}`,
    content: [
      `Agent memory verification message ${index}.`,
      "Keep decisions, evidence:ev-agent-memory, and tool status stable across compaction.",
      "This sentence is intentionally repeated to make the source large enough for compaction."
    ].join(" ")
  };
}

const agentMemory = createAgentMemory({ userDataPath });
assert.equal(agentMemory.protocolVersion, AGENT_MEMORY_PROTOCOL_VERSION);
assert.equal(agentMemory.sessionMemoryPath, path.join(userDataPath, "agent-memory", "session-memory.jsonl"));

const appended = await agentMemory.appendSessionMemory({
  sessionId: "direct-session",
  profileId: "balanced",
  sourceHash: "hash-a",
  summary: "Use API token=secret and local file /Users/unka/private/source.txt.",
  structured: {
    keep: "decision",
    nested: {
      apiKey: "secret"
    }
  }
});
assert.equal(appended.protocolVersion, AGENT_MEMORY_PROTOCOL_VERSION);
assert.match(appended.memoryId, /^agent_memory_/);
assert.match(appended.summary, /<redacted>/);
assert.equal(appended.structured.nested.apiKey, "<redacted>");

const exact = await agentMemory.latestSessionMemory({
  sessionId: "direct-session",
  profileId: "balanced",
  sourceHash: "hash-a"
});
assert.equal(exact.memoryId, appended.memoryId);

const missingHash = await agentMemory.latestSessionMemory({
  sessionId: "direct-session",
  profileId: "balanced",
  sourceHash: "hash-b"
});
assert.equal(missingHash, null);

const oldContextPath = path.join(userDataPath, "context-core", "context-session-memory.jsonl");
await fs.mkdir(path.dirname(oldContextPath), { recursive: true });
await fs.appendFile(
  oldContextPath,
  `${JSON.stringify({
    protocolVersion: "v0.0.1:agent:context-compaction-1",
    memoryId: "old-context-memory",
    sessionId: "old-context-session",
    profileId: "balanced",
    sourceHash: "old-context-hash",
    summary: "Old context memory must not load.",
    structured: {},
    sourceRange: {},
    createdAt: new Date(Date.now() - 1000).toISOString(),
    status: "active"
  })}\n`,
  "utf8"
);
const oldContextRecord = await agentMemory.latestSessionMemory({
  sessionId: "old-context-session",
  profileId: "balanced",
  sourceHash: "old-context-hash"
});
assert.equal(oldContextRecord, null);

const cleared = await agentMemory.clearSessionMemory({
  sessionId: "direct-session",
  profileId: "balanced",
  reason: "verify"
});
assert.equal(cleared.ok, true);
const afterClear = await agentMemory.latestSessionMemory({
  sessionId: "direct-session",
  profileId: "balanced"
});
assert.equal(afterClear, null);

const contextRuntime = createContextRuntime({
  userDataPath,
  agentMemory
});
const messages = Array.from({ length: 24 }, (_, index) => message(index + 1));
const firstRun = await contextRuntime.runCompaction({
  contextProfileId: "balanced",
  sessionId: "runtime-session",
  messages,
  taskBrief: "Verify ContextRuntime persists through AgentMemory.",
  force: true,
  useSessionMemory: false
});
assert.equal(firstRun.status, "completed");
assert.notEqual(firstRun.executionMode, "session-memory");

const runtimeRecords = await agentMemory.listSessionMemory({ sessionId: "runtime-session" });
assert.equal(runtimeRecords.path, agentMemory.sessionMemoryPath);
assert.equal(runtimeRecords.records.length >= 1, true);
assert.equal(runtimeRecords.records[0].storagePath, agentMemory.sessionMemoryPath);

const reusedRun = await contextRuntime.runCompaction({
  contextProfileId: "balanced",
  sessionId: "runtime-session",
  messages,
  taskBrief: "Verify ContextRuntime persists through AgentMemory.",
  force: true
});
assert.equal(reusedRun.executionMode, "session-memory");

console.log("Agent memory verification passed.");
process.exit(0);
