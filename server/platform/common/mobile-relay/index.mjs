import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MOBILE_RELAY_PROTOCOL_VERSION = "v0.0.1:mcp:mobile-relay-1";
export const DEFAULT_PACT_MOBILE_RELAY_GATEWAY_URL = "https://relay.pact.run";

const STORE_SCHEMA_VERSION = "v0.0.1:mcp:mobile-relay-store-schema-1";
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
export const MAX_PACT_MOBILE_RELAY_PAIRING_TTL_MS = 30 * 60 * 1000;
export const MAX_PACT_MOBILE_RELAY_PAIRINGS = 500;
export const MAX_PACT_MOBILE_RELAY_PENDING_PAIRINGS_PER_SOURCE = 5;
export const MAX_PACT_MOBILE_RELAY_PENDING_PAIRINGS_PER_PC_CLIENT = 3;
export const MAX_PACT_MOBILE_RELAY_CLAIM_FAILURES_PER_SOURCE = 10;
const DEFAULT_COMMAND_LEASE_MS = 60 * 1000;
const MAX_COMMAND_HISTORY = 500;
const DEFAULT_CLAIM_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_PAIRING_DESCRIPTOR_BYTES = 16 * 1024;
const MAX_RELAY_TARGETS = 50;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_PATTERN = /^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/;
const SUPPORTED_MOBILE_COMMAND_TYPES = new Set([
  "targets.scan",
  "agent.sessions.list",
  "agent.message.send"
]);
const AGENT_MESSAGE_SEND_PAYLOAD_FIELDS = new Set([
  "agent",
  "agentId",
  "target",
  "text",
  "message",
  "prompt",
  "sessionId",
  "nativeSessionId",
  "cwd",
  "workingDirectory",
  "timeoutMs",
  "maxStdoutBytes",
  "maxStderrBytes"
]);
const AGENT_MESSAGE_SEND_LOCAL_RUNTIME_FIELDS = new Set([
  "command",
  "args",
  "stdin",
  "executable",
  "binaryPath",
  "commandPath",
  "env",
  "environment",
  "shell"
]);

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function nowIso(now = new Date()) {
  return new Date(now).toISOString();
}

function normalizeBaseUrl(value = "") {
  return text(value).replace(/\/+$/, "");
}

function hashSecret(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function timingSafeStringEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomCode() {
  let value = "";
  for (let index = 0; index < 20; index += 1) {
    value += PAIRING_CODE_ALPHABET[crypto.randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
}

function hashedPolicyKey(value = "", namespace = "mobile-relay") {
  const key = text(value);
  return key ? hashSecret(`${namespace}:${key}`) : "";
}

function normalizePairingTtlMs(value) {
  const parsed = Number(value || DEFAULT_PAIRING_TTL_MS);
  const ttlMs = Number.isFinite(parsed) ? parsed : DEFAULT_PAIRING_TTL_MS;
  return Math.max(60_000, Math.min(ttlMs, MAX_PACT_MOBILE_RELAY_PAIRING_TTL_MS));
}

function normalizePairingCode(value = "") {
  const compact = text(value).replace(/[\s-]+/g, "").toUpperCase();
  const normalized = compact.length === 20
    ? `${compact.slice(0, 5)}-${compact.slice(5, 10)}-${compact.slice(10, 15)}-${compact.slice(15)}`
    : text(value).toUpperCase();
  return PAIRING_CODE_PATTERN.test(normalized) ? normalized : "";
}

function pairingSortTime(pairing = {}) {
  return Date.parse(pairing.updatedAt || pairing.createdAt || pairing.expiresAt || "") || 0;
}

function compactPairingStore(store, {
  nowMs = Date.now(),
  nowText = nowIso(new Date(nowMs)),
  maxPairings = MAX_PACT_MOBILE_RELAY_PAIRINGS,
  reserveSlots = 0
} = {}) {
  const targetPairings = Math.max(0, Number(maxPairings || 0) - Math.max(0, Number(reserveSlots || 0)));
  store.pairings = asObject(store.pairings);
  for (const pairing of Object.values(store.pairings)) {
    if (
      pairing?.status === "pending" &&
      pairing.expiresAt &&
      Date.parse(pairing.expiresAt) <= nowMs
    ) {
      pairing.status = "expired";
      pairing.updatedAt = nowText;
    }
  }

  let entries = Object.entries(store.pairings);
  if (entries.length <= targetPairings) {
    return;
  }

  const removable = entries
    .filter(([, pairing]) => !["pending", "paired"].includes(pairing?.status || ""))
    .sort((left, right) => pairingSortTime(left[1]) - pairingSortTime(right[1]));
  for (const [pairingId] of removable) {
    if (Object.keys(store.pairings).length <= targetPairings) {
      return;
    }
    delete store.pairings[pairingId];
  }
}

function compactClaimFailureStore(store, { nowMs = Date.now() } = {}) {
  store.claimFailures = asObject(store.claimFailures);
  for (const [sourceHash, entry] of Object.entries(store.claimFailures)) {
    const windowExpiresAt = Date.parse(entry.windowExpiresAt || "");
    const lockedUntil = Date.parse(entry.lockedUntil || "");
    if (
      (!Number.isFinite(windowExpiresAt) || windowExpiresAt <= nowMs) &&
      (!Number.isFinite(lockedUntil) || lockedUntil <= nowMs)
    ) {
      delete store.claimFailures[sourceHash];
    }
  }
}

function sourceClaimFailure(store, sourceHash = "", { nowMs = Date.now() } = {}) {
  if (!sourceHash) {
    return null;
  }
  store.claimFailures = asObject(store.claimFailures);
  const entry = asObject(store.claimFailures[sourceHash], null);
  if (!entry) {
    return null;
  }
  const lockedUntil = Date.parse(entry.lockedUntil || "");
  if (Number.isFinite(lockedUntil) && lockedUntil > nowMs) {
    return entry;
  }
  return null;
}

function recordClaimFailure(store, sourceHash = "", {
  nowMs = Date.now(),
  nowText = nowIso(new Date(nowMs)),
  maxFailures = MAX_PACT_MOBILE_RELAY_CLAIM_FAILURES_PER_SOURCE,
  windowMs = DEFAULT_CLAIM_FAILURE_WINDOW_MS
} = {}) {
  if (!sourceHash || maxFailures <= 0) {
    return { locked: false };
  }
  store.claimFailures = asObject(store.claimFailures);
  const existing = asObject(store.claimFailures[sourceHash], {});
  const windowExpiresMs = Date.parse(existing.windowExpiresAt || "");
  const resetWindow = !Number.isFinite(windowExpiresMs) || windowExpiresMs <= nowMs;
  const count = resetWindow ? 1 : Math.max(0, Number(existing.count || 0)) + 1;
  const windowExpiresAt = resetWindow
    ? nowIso(new Date(nowMs + windowMs))
    : existing.windowExpiresAt;
  const locked = count >= maxFailures;
  const entry = {
    count,
    firstFailedAt: resetWindow ? nowText : text(existing.firstFailedAt || nowText),
    lastFailedAt: nowText,
    windowExpiresAt,
    lockedUntil: locked ? windowExpiresAt : text(existing.lockedUntil)
  };
  store.claimFailures[sourceHash] = entry;
  return { locked, entry };
}

function clearClaimFailures(store, sourceHash = "") {
  if (!sourceHash) {
    return;
  }
  store.claimFailures = asObject(store.claimFailures);
  delete store.claimFailures[sourceHash];
}

function pendingPairings(store = {}, nowMs = Date.now()) {
  return Object.values(asObject(store.pairings)).filter((pairing) => (
    pairing?.status === "pending" &&
    (!pairing.expiresAt || Date.parse(pairing.expiresAt) > nowMs)
  ));
}

function publicPairing(pairing = {}) {
  const {
    pcTokenHash: _pcTokenHash,
    mobileTokenHash: _mobileTokenHash,
    pairingCodeHash: _pairingCodeHash,
    createSourceHash: _createSourceHash,
    ...safe
  } = pairing;
  return {
    ...safe,
    pc: {
      ...(safe.pc || {}),
      tokenConfigured: Boolean(pairing.pcTokenHash)
    },
    mobile: pairing.mobile
      ? {
          ...pairing.mobile,
          tokenConfigured: Boolean(pairing.mobileTokenHash)
        }
      : null
  };
}

function publicCommand(command = {}) {
  return {
    commandId: command.commandId || "",
    pairingId: command.pairingId || "",
    type: command.type || "",
    payload: asObject(command.payload),
    status: command.status || "pending",
    createdAt: command.createdAt || "",
    updatedAt: command.updatedAt || "",
    deliveredAt: command.deliveredAt || "",
    completedAt: command.completedAt || "",
    result: command.result,
    error: command.error || ""
  };
}

function emptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
    pairings: {},
    claimFailures: {}
  };
}

function normalizeRelayTargets(value) {
  return asArray(value).slice(0, MAX_RELAY_TARGETS);
}

function sanitizeMobileCommandPayload(type = "", value = {}) {
  const payload = asObject(value);
  if (!SUPPORTED_MOBILE_COMMAND_TYPES.has(type)) {
    return {
      ok: false,
      status: 400,
      error: "移动中转命令类型未启用。",
      code: "mobile_relay_command_type_unsupported"
    };
  }
  if (type === "targets.scan") {
    return { ok: true, payload: {} };
  }
  if (type === "agent.message.send") {
    for (const key of AGENT_MESSAGE_SEND_LOCAL_RUNTIME_FIELDS) {
      if (Object.hasOwn(payload, key)) {
        return {
          ok: false,
          status: 400,
          error: "移动中转消息命令不能携带本地运行时执行字段。",
          code: "mobile_relay_command_payload_denied"
        };
      }
    }
    const sanitized = {};
    for (const [key, nested] of Object.entries(payload)) {
      if (AGENT_MESSAGE_SEND_PAYLOAD_FIELDS.has(key)) {
        sanitized[key] = nested;
      }
    }
    return { ok: true, payload: sanitized };
  }
  return { ok: true, payload };
}

function bearerTokenFromHeaders(headers = {}) {
  const authorization = String(headers.authorization || headers.Authorization || "").trim();
  if (/^bearer\s+/i.test(authorization)) {
    return authorization.replace(/^bearer\s+/i, "").trim();
  }
  return text(headers["x-pact-mobile-relay-token"] || headers["X-Pact-Mobile-Relay-Token"]);
}

function readToken(input = {}, headers = {}, ...keys) {
  for (const key of keys) {
    const candidate = text(input[key]);
    if (candidate) {
      return candidate;
    }
  }
  return bearerTokenFromHeaders(headers);
}

function externalAuthRule(operationId = "") {
  switch (operationId) {
    case "mobile_relay.pairing.status":
    case "mobile_relay.pairing.revoke":
      return { roles: ["pc", "mobile"], tokenKeys: ["pcToken", "mobileToken", "token"], invalidCode: "invalid_pairing_token" };
    case "mobile_relay.pc.check_in":
    case "mobile_relay.command.poll":
    case "mobile_relay.command.complete":
      return { roles: ["pc"], tokenKeys: ["pcToken", "token"], invalidCode: "invalid_pc_token" };
    case "mobile_relay.command.create":
    case "mobile_relay.command.result":
      return { roles: ["mobile"], tokenKeys: ["mobileToken", "token"], invalidCode: "invalid_mobile_token" };
    default:
      return null;
  }
}

function result(status, payload = {}) {
  return { status, payload };
}

function errorResult(status, error, code = "") {
  return result(status, {
    ok: false,
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
    error,
    code
  });
}

export function resolveDefaultMobileRelayGatewayUrl(env = process.env) {
  return normalizeBaseUrl(
    env.PACT_MOBILE_RELAY_GATEWAY_URL ||
      env.PACT_RELAY_GATEWAY_URL ||
      env.PACT_PUBLIC_RELAY_URL ||
      DEFAULT_PACT_MOBILE_RELAY_GATEWAY_URL
  );
}

export function createMobileRelayStore({
  userDataPath,
  storePath = "",
  now = () => new Date(),
  maxPairings = MAX_PACT_MOBILE_RELAY_PAIRINGS,
  maxPendingPairingsPerSource = MAX_PACT_MOBILE_RELAY_PENDING_PAIRINGS_PER_SOURCE,
  maxPendingPairingsPerPcClient = MAX_PACT_MOBILE_RELAY_PENDING_PAIRINGS_PER_PC_CLIENT,
  maxClaimFailuresPerSource = MAX_PACT_MOBILE_RELAY_CLAIM_FAILURES_PER_SOURCE,
  claimFailureWindowMs = DEFAULT_CLAIM_FAILURE_WINDOW_MS,
  maxPairingDescriptorBytes = MAX_PAIRING_DESCRIPTOR_BYTES
} = {}) {
  if (!text(userDataPath) && !text(storePath)) {
    throw new Error("createMobileRelayStore requires userDataPath or storePath.");
  }
  const filePath = path.resolve(
    storePath || path.join(userDataPath, "mobile-relay", "relay-store.json")
  );
  let writeQueue = Promise.resolve();
  const maxStoredPairings = Math.max(
    1,
    Math.floor(Number(maxPairings || MAX_PACT_MOBILE_RELAY_PAIRINGS) || MAX_PACT_MOBILE_RELAY_PAIRINGS)
  );
  const sourcePendingLimit = Math.max(0, Math.floor(Number(maxPendingPairingsPerSource || 0) || 0));
  const pcClientPendingLimit = Math.max(0, Math.floor(Number(maxPendingPairingsPerPcClient || 0) || 0));
  const sourceClaimFailureLimit = Math.max(0, Math.floor(Number(maxClaimFailuresPerSource || 0) || 0));
  const claimFailureWindow = Math.max(60_000, Number(claimFailureWindowMs || DEFAULT_CLAIM_FAILURE_WINDOW_MS) || DEFAULT_CLAIM_FAILURE_WINDOW_MS);
  const pairingDescriptorBytes = Math.max(1024, Number(maxPairingDescriptorBytes || MAX_PAIRING_DESCRIPTOR_BYTES) || MAX_PAIRING_DESCRIPTOR_BYTES);

  async function readStore() {
    try {
      const decoded = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
        return {
          ...emptyStore(),
          ...decoded,
          pairings: asObject(decoded.pairings),
          claimFailures: asObject(decoded.claimFailures)
        };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        const corruptPath = `${filePath}.corrupt.${Date.now()}`;
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.rename(filePath, corruptPath).catch(() => null);
      }
    }
    return emptyStore();
  }

  async function writeStore(store) {
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
      );
      await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
      await fs.rename(temp, filePath);
    });
    return writeQueue;
  }

  async function mutate(mutator) {
    await writeQueue;
    const store = await readStore();
    const mutation = await mutator(store);
    await writeStore(store);
    return mutation;
  }

  function pairingById(store, pairingId = "") {
    const pairing = store.pairings[text(pairingId)];
    return pairing && typeof pairing === "object" ? pairing : null;
  }

  function authorizePc(pairing, token = "") {
    return Boolean(
      pairing?.pcTokenHash &&
        token &&
        timingSafeStringEqual(pairing.pcTokenHash, hashSecret(token))
    );
  }

  function authorizeMobile(pairing, token = "") {
    return Boolean(
      pairing?.mobileTokenHash &&
        token &&
        timingSafeStringEqual(pairing.mobileTokenHash, hashSecret(token))
    );
  }

  function ensureActivePairing(pairing) {
    if (!pairing) {
      return errorResult(404, "配对不存在。", "pairing_not_found");
    }
    if (pairing.status !== "paired" && pairing.status !== "pending") {
      return errorResult(409, "配对当前不可用。", "pairing_unavailable");
    }
    return null;
  }

  function externalAuthDenied(status, error, reasonCode) {
    return {
      ok: false,
      status,
      error,
      reasonCode
    };
  }

  return {
    filePath,

    gatewayConfig(env = process.env) {
      return {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        defaultGatewayUrl: resolveDefaultMobileRelayGatewayUrl(env),
        envKeys: [
          "PACT_MOBILE_RELAY_GATEWAY_URL",
          "PACT_RELAY_GATEWAY_URL",
          "PACT_PUBLIC_RELAY_URL"
        ],
        privateCloudOverrideSupported: true
      };
    },

    async authorizeExternalOperation({ operationId = "", input = {}, headers = {} } = {}) {
      const rule = externalAuthRule(operationId);
      if (!rule) {
        return externalAuthDenied(503, "Mobile relay external authentication rule is not registered.", "mobile_relay_auth_rule_missing");
      }
      const pairingId = text(input.pairingId);
      if (!pairingId) {
        return externalAuthDenied(400, "缺少配对 ID。", "missing_pairing_id");
      }
      const token = readToken(input, headers, ...rule.tokenKeys);
      if (!token) {
        return externalAuthDenied(401, "缺少移动中转访问 token。", "missing_mobile_relay_token");
      }
      const store = await readStore();
      const pairing = pairingById(store, pairingId);
      const missing = ensureActivePairing(pairing);
      if (missing) {
        return externalAuthDenied(missing.status || 401, missing.payload?.error || "配对不可用。", missing.payload?.code || "pairing_unavailable");
      }
      const pcAllowed = rule.roles.includes("pc") && authorizePc(pairing, token);
      const mobileAllowed = rule.roles.includes("mobile") && authorizeMobile(pairing, token);
      if (!pcAllowed && !mobileAllowed) {
        return externalAuthDenied(401, "移动中转访问 token 无效。", rule.invalidCode);
      }
      const role = pcAllowed ? "pc" : "mobile";
      return {
        ok: true,
        actor: {
          type: "mobile-relay",
          userId: pairingId,
          username: role === "pc" ? pairing.pc?.label || pairingId : pairing.mobile?.label || pairingId,
          roleId: `mobile-relay-${role}`,
          scopes: [`mobile_relay:${role}`]
        },
        pairing: publicPairing(pairing),
        role
      };
    },

    async createPairing(input = {}, context = {}) {
      if (jsonByteLength({
        pcClientId: input.pcClientId || input.clientId,
        pcClientName: input.pcClientName || input.pcLabel || input.deviceName,
        platform: input.platform,
        capabilities: input.capabilities,
        targets: input.targets
      }) > pairingDescriptorBytes) {
        return errorResult(413, "移动中转配对描述过大。", "mobile_relay_pairing_descriptor_too_large");
      }
      const pairingCode = randomCode();
      const pcToken = randomToken();
      const pairingId = `pair_${crypto.randomUUID()}`;
      const createdAt = nowIso(now());
      const ttlMs = normalizePairingTtlMs(input.ttlMs);
      const expiresAt = nowIso(new Date(Date.parse(createdAt) + ttlMs));
      const pcClientId = text(input.pcClientId || input.clientId || `pc_${crypto.randomUUID()}`);
      const createSourceHash = hashedPolicyKey(context.sourceKey, "mobile-relay-pairing-create-source");
      const pairing = {
        pairingId,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        pairedAt: "",
        pairingCodeHash: hashSecret(pairingCode),
        pcTokenHash: hashSecret(pcToken),
        mobileTokenHash: "",
        createSourceHash,
        pc: {
          clientId: pcClientId,
          label: text(input.pcClientName || input.pcLabel || input.deviceName || "Pact PC Client"),
          platform: text(input.platform || process.platform),
          capabilities: asObject(input.capabilities),
          targets: normalizeRelayTargets(input.targets),
          lastSeenAt: createdAt
        },
        mobile: null,
        commands: []
      };
      const mutation = await mutate((store) => {
        compactPairingStore(store, {
          nowMs: Date.parse(createdAt),
          nowText: createdAt,
          maxPairings: maxStoredPairings,
          reserveSlots: 1
        });
        const activePending = pendingPairings(store, Date.parse(createdAt));
        if (
          sourcePendingLimit > 0 &&
          createSourceHash &&
          activePending.filter((item) => item.createSourceHash === createSourceHash).length >= sourcePendingLimit
        ) {
          return errorResult(429, "移动中转配对创建过于频繁，请稍后再试。", "mobile_relay_pairing_source_quota_exceeded");
        }
        if (
          pcClientPendingLimit > 0 &&
          pcClientId &&
          activePending.filter((item) => text(item.pc?.clientId) === pcClientId).length >= pcClientPendingLimit
        ) {
          return errorResult(429, "此 PC 客户端已有待认领配对，请先使用或清理旧配对。", "mobile_relay_pairing_client_quota_exceeded");
        }
        if (Object.keys(store.pairings).length >= maxStoredPairings) {
          return errorResult(429, "移动中转配对容量已满，请先清理或等待旧配对过期。", "mobile_relay_pairing_capacity_exceeded");
        }
        store.pairings[pairingId] = pairing;
        return null;
      });
      if (mutation) {
        return mutation;
      }
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        pairing: publicPairing(pairing),
        pairingId,
        pairingCode,
        pcToken,
        expiresAt
      });
    },

    async claimPairing(input = {}, context = {}) {
      const pairingId = text(input.pairingId || input.pairing_id || input.id);
      if (!pairingId) {
        return errorResult(400, "缺少配对 ID。", "missing_pairing_id");
      }
      const rawPairingCode = text(input.pairingCode || input.code);
      const pairingCode = normalizePairingCode(rawPairingCode);
      if (rawPairingCode && !pairingCode) {
        return errorResult(400, "配对码格式无效。", "invalid_pairing_code");
      }
      if (!pairingCode) {
        return errorResult(400, "缺少配对码。", "missing_pairing_code");
      }
      const mobileToken = randomToken();
      let claimedPairing = null;
      const codeHash = hashSecret(pairingCode);
      const nowText = nowIso(now());
      const nowMs = Date.parse(nowText);
      const claimSourceHash = hashedPolicyKey(context.sourceKey, "mobile-relay-pairing-claim-source");
      const mutation = await mutate((store) => {
        compactPairingStore(store, {
          nowMs,
          nowText,
          maxPairings: maxStoredPairings
        });
        compactClaimFailureStore(store, { nowMs });
        if (sourceClaimFailure(store, claimSourceHash, { nowMs })) {
          return errorResult(429, "配对码尝试过于频繁，请稍后再试。", "mobile_relay_pairing_claim_rate_limited");
        }
        const pairing = pairingById(store, pairingId);
        if (!pairing) {
          const failure = recordClaimFailure(store, claimSourceHash, {
            nowMs,
            nowText,
            maxFailures: sourceClaimFailureLimit,
            windowMs: claimFailureWindow
          });
          if (failure.locked) {
            return errorResult(429, "配对码尝试过于频繁，请稍后再试。", "mobile_relay_pairing_claim_rate_limited");
          }
          return errorResult(404, "配对不存在。", "pairing_not_found");
        }
        if (!timingSafeStringEqual(pairing.pairingCodeHash, codeHash)) {
          const failure = recordClaimFailure(store, claimSourceHash, {
            nowMs,
            nowText,
            maxFailures: sourceClaimFailureLimit,
            windowMs: claimFailureWindow
          });
          if (failure.locked) {
            return errorResult(429, "配对码尝试过于频繁，请稍后再试。", "mobile_relay_pairing_claim_rate_limited");
          }
          return errorResult(404, "配对码不存在。", "pairing_code_not_found");
        }
        if (pairing.status === "expired") {
          return errorResult(410, "配对码已过期。", "pairing_code_expired");
        }
        if (pairing.status !== "pending") {
          return errorResult(409, "配对码已被使用。", "pairing_code_used");
        }
        if (Date.parse(pairing.expiresAt || "") <= nowMs) {
          pairing.status = "expired";
          pairing.updatedAt = nowText;
          return errorResult(410, "配对码已过期。", "pairing_code_expired");
        }
        pairing.status = "paired";
        pairing.updatedAt = nowText;
        pairing.pairedAt = nowText;
        pairing.mobileTokenHash = hashSecret(mobileToken);
        pairing.mobile = {
          deviceId: text(input.mobileDeviceId || input.deviceId || `mobile_${crypto.randomUUID()}`),
          label: text(input.mobileDeviceName || input.mobileLabel || input.deviceName || "Pact Mobile"),
          platform: text(input.platform || "mobile"),
          pairedAt: nowText,
          lastSeenAt: nowText
        };
        clearClaimFailures(store, claimSourceHash);
        claimedPairing = pairing;
        return null;
      });
      if (mutation) {
        return mutation;
      }
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        pairing: publicPairing(claimedPairing),
        pairingId: claimedPairing.pairingId,
        mobileToken
      });
    },

    async pairingStatus(input = {}, headers = {}) {
      const pairingId = text(input.pairingId);
      const token = readToken(input, headers, "pcToken", "mobileToken", "token");
      const store = await readStore();
      const pairing = pairingById(store, pairingId);
      const missing = ensureActivePairing(pairing);
      if (missing) return missing;
      if (!authorizePc(pairing, token) && !authorizeMobile(pairing, token)) {
        return errorResult(401, "配对 token 无效。", "invalid_pairing_token");
      }
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        pairing: publicPairing(pairing)
      });
    },

    async checkIn(input = {}, headers = {}) {
      const pairingId = text(input.pairingId);
      const token = readToken(input, headers, "pcToken", "token");
      let updatedPairing = null;
      const mutation = await mutate((store) => {
        const pairing = pairingById(store, pairingId);
        const missing = ensureActivePairing(pairing);
        if (missing) return missing;
        if (!authorizePc(pairing, token)) {
          return errorResult(401, "PC token 无效。", "invalid_pc_token");
        }
        const checkedAt = nowIso(now());
        pairing.status = pairing.status === "pending" ? "pending" : "paired";
        pairing.updatedAt = checkedAt;
        pairing.pc = {
          ...asObject(pairing.pc),
          targets: asArray(input.targets),
          capabilities: asObject(input.capabilities, asObject(pairing.pc?.capabilities)),
          clientVersion: text(input.clientVersion || pairing.pc?.clientVersion),
          lastSeenAt: checkedAt
        };
        updatedPairing = pairing;
        return null;
      });
      if (mutation) return mutation;
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        pairing: publicPairing(updatedPairing)
      });
    },

    async enqueueCommand(input = {}, headers = {}) {
      const pairingId = text(input.pairingId);
      const token = readToken(input, headers, "mobileToken", "token");
      const type = text(input.type || input.commandType || input.command?.type);
      if (!type) {
        return errorResult(400, "缺少命令类型。", "missing_command_type");
      }
      let command = null;
      const mutation = await mutate((store) => {
        const pairing = pairingById(store, pairingId);
        const missing = ensureActivePairing(pairing);
        if (missing) return missing;
        if (!authorizeMobile(pairing, token)) {
          return errorResult(401, "手机 token 无效。", "invalid_mobile_token");
        }
        const sanitizedPayload = sanitizeMobileCommandPayload(
          type,
          input.payload || input.command?.payload
        );
        if (!sanitizedPayload.ok) {
          return errorResult(
            sanitizedPayload.status || 400,
            sanitizedPayload.error || "移动中转命令负载未启用。",
            sanitizedPayload.code || "mobile_relay_command_payload_denied"
          );
        }
        const createdAt = nowIso(now());
        command = {
          commandId: `cmd_${crypto.randomUUID()}`,
          pairingId,
          type,
          payload: sanitizedPayload.payload,
          status: "pending",
          createdAt,
          updatedAt: createdAt,
          deliveredAt: "",
          leaseExpiresAt: "",
          completedAt: "",
          result: null,
          error: "",
          idempotencyKey: text(input.idempotencyKey)
        };
        pairing.commands = asArray(pairing.commands);
        pairing.commands.push(command);
        if (pairing.commands.length > MAX_COMMAND_HISTORY) {
          pairing.commands = pairing.commands.slice(pairing.commands.length - MAX_COMMAND_HISTORY);
        }
        pairing.updatedAt = createdAt;
        pairing.mobile = {
          ...asObject(pairing.mobile),
          lastSeenAt: createdAt
        };
        return null;
      });
      if (mutation) return mutation;
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        command: publicCommand(command)
      });
    },

    async pollCommands(input = {}, headers = {}) {
      const pairingId = text(input.pairingId);
      const token = readToken(input, headers, "pcToken", "token");
      const limit = Math.min(50, Math.max(1, Number(input.limit || 10) || 10));
      const leaseMs = Math.max(5_000, Number(input.leaseMs || DEFAULT_COMMAND_LEASE_MS) || DEFAULT_COMMAND_LEASE_MS);
      let commands = [];
      const mutation = await mutate((store) => {
        const pairing = pairingById(store, pairingId);
        const missing = ensureActivePairing(pairing);
        if (missing) return missing;
        if (!authorizePc(pairing, token)) {
          return errorResult(401, "PC token 无效。", "invalid_pc_token");
        }
        const polledAt = nowIso(now());
        const nowMs = Date.parse(polledAt);
        commands = asArray(pairing.commands)
          .filter((command) => {
            if (command.status === "pending") return true;
            if (command.status !== "in_progress") return false;
            return Date.parse(command.leaseExpiresAt || "") <= nowMs;
          })
          .slice(0, limit);
        for (const command of commands) {
          command.status = "in_progress";
          command.deliveredAt = command.deliveredAt || polledAt;
          command.updatedAt = polledAt;
          command.leaseExpiresAt = nowIso(new Date(nowMs + leaseMs));
        }
        pairing.updatedAt = polledAt;
        pairing.pc = {
          ...asObject(pairing.pc),
          lastSeenAt: polledAt
        };
        return null;
      });
      if (mutation) return mutation;
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        commands: commands.map(publicCommand)
      });
    },

    async completeCommand(input = {}, headers = {}) {
      const pairingId = text(input.pairingId);
      const commandId = text(input.commandId);
      const token = readToken(input, headers, "pcToken", "token");
      let command = null;
      const mutation = await mutate((store) => {
        const pairing = pairingById(store, pairingId);
        const missing = ensureActivePairing(pairing);
        if (missing) return missing;
        if (!authorizePc(pairing, token)) {
          return errorResult(401, "PC token 无效。", "invalid_pc_token");
        }
        command = asArray(pairing.commands).find((item) => item.commandId === commandId);
        if (!command) {
          return errorResult(404, "命令不存在。", "command_not_found");
        }
        const completedAt = nowIso(now());
        const ok = input.ok !== false && !text(input.error);
        command.status = ok ? "completed" : "failed";
        command.result = input.result === undefined ? null : input.result;
        command.error = ok ? "" : text(input.error || "command failed");
        command.completedAt = completedAt;
        command.updatedAt = completedAt;
        pairing.updatedAt = completedAt;
        return null;
      });
      if (mutation) return mutation;
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        command: publicCommand(command)
      });
    },

    async commandResult(input = {}, headers = {}) {
      const pairingId = text(input.pairingId);
      const commandId = text(input.commandId);
      const token = readToken(input, headers, "mobileToken", "token");
      const store = await readStore();
      const pairing = pairingById(store, pairingId);
      const missing = ensureActivePairing(pairing);
      if (missing) return missing;
      if (!authorizeMobile(pairing, token)) {
        return errorResult(401, "手机 token 无效。", "invalid_mobile_token");
      }
      const command = asArray(pairing.commands).find((item) => item.commandId === commandId);
      if (!command) {
        return errorResult(404, "命令不存在。", "command_not_found");
      }
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        command: publicCommand(command)
      });
    },

    async revokePairing(input = {}, headers = {}) {
      const pairingId = text(input.pairingId);
      const token = readToken(input, headers, "pcToken", "mobileToken", "token");
      let revokedPairing = null;
      const mutation = await mutate((store) => {
        const pairing = pairingById(store, pairingId);
        const missing = ensureActivePairing(pairing);
        if (missing) return missing;
        if (!authorizePc(pairing, token) && !authorizeMobile(pairing, token)) {
          return errorResult(401, "配对 token 无效。", "invalid_pairing_token");
        }
        const revokedAt = nowIso(now());
        pairing.status = "revoked";
        pairing.updatedAt = revokedAt;
        revokedPairing = pairing;
        return null;
      });
      if (mutation) return mutation;
      return result(200, {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MOBILE_RELAY_PROTOCOL_VERSION,
        pairing: publicPairing(revokedPairing)
      });
    }
  };
}
