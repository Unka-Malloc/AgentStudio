import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MOBILE_RELAY_PROTOCOL_VERSION = "v0.0.1:mcp:mobile-relay-1";
export const DEFAULT_PACT_MOBILE_RELAY_GATEWAY_URL = "https://relay.pact.run";

const STORE_SCHEMA_VERSION = "v0.0.1:mcp:mobile-relay-store-schema-1";
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
export const MAX_PACT_MOBILE_RELAY_PAIRING_TTL_MS = 30 * 60 * 1000;
export const MAX_PACT_MOBILE_RELAY_PAIRINGS = 500;
const DEFAULT_COMMAND_LEASE_MS = 60 * 1000;
const MAX_COMMAND_HISTORY = 500;
const PAIRING_CODE_PATTERN = /^\d{4}-\d{4}$/;

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
  const value = crypto.randomInt(0, 100_000_000).toString().padStart(8, "0");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function normalizePairingTtlMs(value) {
  const parsed = Number(value || DEFAULT_PAIRING_TTL_MS);
  const ttlMs = Number.isFinite(parsed) ? parsed : DEFAULT_PAIRING_TTL_MS;
  return Math.max(60_000, Math.min(ttlMs, MAX_PACT_MOBILE_RELAY_PAIRING_TTL_MS));
}

function normalizePairingCode(value = "") {
  const compact = text(value).replace(/\s+/g, "").toUpperCase();
  const normalized = /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4)}`
    : compact;
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

function publicPairing(pairing = {}) {
  const {
    pcTokenHash: _pcTokenHash,
    mobileTokenHash: _mobileTokenHash,
    pairingCodeHash: _pairingCodeHash,
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
    pairings: {}
  };
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
  maxPairings = MAX_PACT_MOBILE_RELAY_PAIRINGS
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

  async function readStore() {
    try {
      const decoded = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
        return {
          ...emptyStore(),
          ...decoded,
          pairings: asObject(decoded.pairings)
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

    async createPairing(input = {}) {
      const pairingCode = randomCode();
      const pcToken = randomToken();
      const pairingId = `pair_${crypto.randomUUID()}`;
      const createdAt = nowIso(now());
      const ttlMs = normalizePairingTtlMs(input.ttlMs);
      const expiresAt = nowIso(new Date(Date.parse(createdAt) + ttlMs));
      const pcClientId = text(input.pcClientId || input.clientId || `pc_${crypto.randomUUID()}`);
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
        pc: {
          clientId: pcClientId,
          label: text(input.pcClientName || input.pcLabel || input.deviceName || "Pact PC Client"),
          platform: text(input.platform || process.platform),
          capabilities: asObject(input.capabilities),
          targets: asArray(input.targets),
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

    async claimPairing(input = {}) {
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
      const mutation = await mutate((store) => {
        compactPairingStore(store, {
          nowMs,
          nowText,
          maxPairings: maxStoredPairings
        });
        for (const pairing of Object.values(store.pairings)) {
          if (!timingSafeStringEqual(pairing.pairingCodeHash, codeHash)) {
            continue;
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
          claimedPairing = pairing;
          return null;
        }
        return errorResult(404, "配对码不存在。", "pairing_code_not_found");
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
        const createdAt = nowIso(now());
        command = {
          commandId: `cmd_${crypto.randomUUID()}`,
          pairingId,
          type,
          payload: asObject(input.payload || input.command?.payload),
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
