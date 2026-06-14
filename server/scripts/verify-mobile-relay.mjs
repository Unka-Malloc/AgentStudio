#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_PACT_MOBILE_RELAY_GATEWAY_URL,
  MOBILE_RELAY_PROTOCOL_VERSION,
  MAX_PACT_MOBILE_RELAY_PAIRING_TTL_MS,
  createMobileRelayStore,
  resolveDefaultMobileRelayGatewayUrl
} from "../platform/common/mobile-relay/index.mjs";
import { createSystemControllerMobileRelayHandlers } from "../platform/common/console/http/controllers/system-controller-mobile-relay-handlers.mjs";
import { dispatchOperation } from "../platform/common/operation-dispatcher/operation-dispatcher.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  filterOperationsForFeatures,
  operationFeatureId,
  resolveFeatureRuntime
} from "../platform/interactive/features/feature-manifest.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-mobile-relay-"));
const store = createMobileRelayStore({ userDataPath: tempRoot });
const mobileRelayHandlers = createSystemControllerMobileRelayHandlers({
  parseJsonBody: (buffer) => JSON.parse(buffer.toString("utf8")),
  mobileRelayStore: store
});

function captureResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    ended: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body = String(chunk || "");
      this.ended = true;
    }
  };
}

async function dispatchMobileRelayOperation(operationId, payload = {}, headers = {}) {
  const operation = SERVER_API_OPERATIONS.find((item) => item.id === operationId);
  assert.ok(operation, `${operationId} must be registered`);
  const response = captureResponse();
  await dispatchOperation({
    operation,
    controllers: { system: mobileRelayHandlers },
    request: { headers, method: operation.http.method },
    response,
    requestBody: Buffer.from(JSON.stringify(payload)),
    url: new URL(operation.http.path, "http://127.0.0.1"),
    authorizeOperation: null
  });
  return {
    status: response.statusCode,
    payload: response.body ? JSON.parse(response.body) : {}
  };
}

assert.equal(resolveDefaultMobileRelayGatewayUrl({}), DEFAULT_PACT_MOBILE_RELAY_GATEWAY_URL);
assert.equal(
  resolveDefaultMobileRelayGatewayUrl({ PACT_MOBILE_RELAY_GATEWAY_URL: "https://relay.example.test/" }),
  "https://relay.example.test"
);

const config = store.gatewayConfig({});
assert.equal(config.protocolVersion, MOBILE_RELAY_PROTOCOL_VERSION);
assert.equal(config.privateCloudOverrideSupported, true);

const created = await store.createPairing({
  pcClientId: "pc-test",
  pcClientName: "Mac Studio",
  targets: [{ target: "codex", label: "Codex" }],
  capabilities: { commands: ["targets.scan", "agent.sessions.list", "agent.message.send"] }
});
assert.equal(created.status, 200);
assert.equal(created.payload.ok, true);
assert.match(created.payload.pairingCode, /^\d{4}-\d{4}$/);
assert.ok(created.payload.pcToken);
assert.equal(created.payload.pairing.status, "pending");
assert.equal(created.payload.pairing.pcTokenHash, undefined);

const longTtlPairing = await store.createPairing({
  pcClientId: "pc-long-ttl",
  ttlMs: 365 * 24 * 60 * 60 * 1000
});
assert.equal(longTtlPairing.status, 200);
assert.equal(
  Date.parse(longTtlPairing.payload.expiresAt) - Date.parse(longTtlPairing.payload.pairing.createdAt),
  MAX_PACT_MOBILE_RELAY_PAIRING_TTL_MS
);

const cappedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-mobile-relay-cap-"));
let cappedNow = new Date("2026-01-01T00:00:00.000Z");
const cappedStore = createMobileRelayStore({
  userDataPath: cappedRoot,
  maxPairings: 1,
  now: () => cappedNow
});
const cappedFirst = await cappedStore.createPairing({ pcClientId: "pc-cap-1", ttlMs: 60_000 });
assert.equal(cappedFirst.status, 200);
const cappedSecond = await cappedStore.createPairing({ pcClientId: "pc-cap-2", ttlMs: 60_000 });
assert.equal(cappedSecond.status, 429);
cappedNow = new Date("2026-01-01T00:02:00.000Z");
const cappedAfterExpiry = await cappedStore.createPairing({ pcClientId: "pc-cap-3", ttlMs: 60_000 });
assert.equal(cappedAfterExpiry.status, 200);

const rejectedClaim = await store.claimPairing({
  pairingCode: "0000-0000",
  mobileDeviceName: "iPhone"
});
assert.equal(rejectedClaim.status, 404);

const malformedClaim = await store.claimPairing({
  pairingCode: "0000-0000".repeat(80),
  mobileDeviceName: "iPhone"
});
assert.equal(malformedClaim.status, 400);
assert.equal(malformedClaim.payload.code, "invalid_pairing_code");

const compactCodePairing = await store.createPairing({
  pcClientId: "pc-compact-code",
  pcClientName: "Compact Code Client"
});
assert.equal(compactCodePairing.status, 200);
const compactCodeClaim = await store.claimPairing({
  pairingCode: compactCodePairing.payload.pairingCode.replace("-", ""),
  mobileDeviceName: "iPhone Compact"
});
assert.equal(compactCodeClaim.status, 200);
assert.equal(compactCodeClaim.payload.ok, true);

const claimed = await store.claimPairing({
  pairingCode: created.payload.pairingCode,
  mobileDeviceName: "iPhone"
});
assert.equal(claimed.status, 200);
assert.equal(claimed.payload.ok, true);
assert.equal(claimed.payload.pairing.status, "paired");
assert.ok(claimed.payload.mobileToken);
assert.equal(claimed.payload.pairing.mobileTokenHash, undefined);

const pairingId = created.payload.pairingId;
const pcToken = created.payload.pcToken;
const mobileToken = claimed.payload.mobileToken;
const authPc = { authorization: `Bearer ${pcToken}` };
const authMobile = { authorization: `Bearer ${mobileToken}` };

const checkIn = await store.checkIn({
  pairingId,
  targets: [{ target: "codex", label: "Codex", status: "detected" }],
  capabilities: { commands: ["targets.scan", "agent.sessions.list", "agent.message.send"] }
}, authPc);
assert.equal(checkIn.status, 200);
assert.equal(checkIn.payload.pairing.pc.targets[0].target, "codex");

const enqueued = await store.enqueueCommand({
  pairingId,
  type: "agent.sessions.list",
  payload: {
    agentId: "codex"
  }
}, authMobile);
assert.equal(enqueued.status, 200);
assert.equal(enqueued.payload.command.status, "pending");
const commandId = enqueued.payload.command.commandId;

const poll = await store.pollCommands({ pairingId, limit: 10 }, authPc);
assert.equal(poll.status, 200);
assert.equal(poll.payload.commands.length, 1);
assert.equal(poll.payload.commands[0].commandId, commandId);
assert.equal(poll.payload.commands[0].status, "in_progress");

const complete = await store.completeCommand({
  pairingId,
  commandId,
  ok: true,
  result: { sessions: [{ id: "session-1", agentId: "codex", messageCount: 2 }] }
}, authPc);
assert.equal(complete.status, 200);
assert.equal(complete.payload.command.status, "completed");

const result = await store.commandResult({ pairingId, commandId }, authMobile);
assert.equal(result.status, 200);
assert.deepEqual(result.payload.command.result, { sessions: [{ id: "session-1", agentId: "codex", messageCount: 2 }] });

const secondPoll = await store.pollCommands({ pairingId }, authPc);
assert.equal(secondPoll.status, 200);
assert.equal(secondPoll.payload.commands.length, 0);

const wrongToken = await store.pollCommands({ pairingId }, { authorization: "Bearer wrong" });
assert.equal(wrongToken.status, 401);

const dispatcherForgedHeader = await dispatchMobileRelayOperation(
  "mobile_relay.command.poll",
  { pairingId },
  { authorization: "Bearer wrong" }
);
assert.equal(dispatcherForgedHeader.status, 401);
assert.equal(dispatcherForgedHeader.payload.error.code, "invalid_pc_token");

const dispatcherValidToken = await dispatchMobileRelayOperation(
  "mobile_relay.command.poll",
  { pairingId },
  authPc
);
assert.equal(dispatcherValidToken.status, 200);

const requiredOperationIds = [
  "mobile_relay.config",
  "mobile_relay.pairing.create",
  "mobile_relay.pairing.claim",
  "mobile_relay.pairing.status",
  "mobile_relay.pairing.revoke",
  "mobile_relay.pc.check_in",
  "mobile_relay.command.create",
  "mobile_relay.command.poll",
  "mobile_relay.command.complete",
  "mobile_relay.command.result"
];
for (const operationId of requiredOperationIds) {
  const operation = SERVER_API_OPERATIONS.find((item) => item.id === operationId);
  assert.ok(operation, `${operationId} must be registered`);
  assert.equal(operationFeatureId(operation), "mobile-relay", `${operationId} must resolve to mobile-relay feature`);
  if (operationId === "mobile_relay.config" || operationId === "mobile_relay.pairing.create" || operationId === "mobile_relay.pairing.claim") {
    assert.equal(operation.public, true, `${operationId} must be public for unauthenticated pairing bootstrap`);
  } else {
    assert.equal(operation.externalAuth, true, `${operationId} must be token protected`);
    assert.equal(operation.externalAuthVerifier?.method, "verifyMobileRelayExternalAuth", `${operationId} must use central relay auth`);
  }
}

const clientLocalRuntime = resolveFeatureRuntime({ edition: "client-local" });
assert.ok(clientLocalRuntime.activeFeatureIds.includes("mobile-relay"));
const activeClientLocalOperationIds = new Set(
  filterOperationsForFeatures(SERVER_API_OPERATIONS, clientLocalRuntime).map((operation) => operation.id)
);
for (const operationId of requiredOperationIds) {
  assert.ok(activeClientLocalOperationIds.has(operationId), `client-local edition must include ${operationId}`);
}

console.log("[mobile-relay] ok");
