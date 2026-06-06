import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const IDENTITY_SCHEMA_VERSION = "pact.mcp.identity.v1";
const HANDSHAKE_SCHEMA_VERSION = "pact.mcp.handshake.v1";

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function identityPath(userDataPath) {
  return path.join(userDataPath, "mcp-identity.json");
}

function keyIdFromPublicKey(publicKeyJwk) {
  return `ed25519:${base64Url(stableStringify(publicKeyJwk)).slice(0, 32)}`;
}

function normalizeIdentity(payload) {
  if (
    payload?.schemaVersion !== IDENTITY_SCHEMA_VERSION ||
    payload?.algorithm !== "Ed25519" ||
    !payload?.publicKeyJwk ||
    !payload?.privateKeyJwk
  ) {
    throw new Error("Invalid MCP identity file.");
  }
  return {
    ...payload,
    keyId: payload.keyId || keyIdFromPublicKey(payload.publicKeyJwk)
  };
}

async function writeIdentity(filePath, identity) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(`${filePath}.tmp`, filePath);
  await fs.chmod(filePath, 0o600);
}

export async function loadOrCreateMcpIdentity(userDataPath) {
  const filePath = identityPath(userDataPath);
  try {
    return normalizeIdentity(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  const identity = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId: keyIdFromPublicKey(publicKeyJwk),
    publicKeyJwk,
    privateKeyJwk: privateKey.export({ format: "jwk" }),
    createdAt: new Date().toISOString()
  };
  await writeIdentity(filePath, identity);
  return identity;
}

export function publicMcpIdentity(identity) {
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId: identity.keyId,
    publicKeyJwk: identity.publicKeyJwk
  };
}

export function buildMcpHandshakePayload({
  nonce,
  issuedAt,
  identity,
  discovery,
  baseUrl,
  vmBaseUrl
}) {
  return {
    schemaVersion: HANDSHAKE_SCHEMA_VERSION,
    nonce,
    issuedAt,
    identity: publicMcpIdentity(identity),
    server: {
      name: "Pact",
      serverId: discovery?.serverId || "",
      serverVersion: discovery?.serverVersion || "",
      interfaceVersion: discovery?.interfaceVersion || "",
      toolsetVersion: discovery?.toolsetVersion || "",
      stableToolName: discovery?.stableToolName || ""
    },
    endpoints: {
      baseUrl,
      mcpUrl: `${baseUrl}/mcp`,
      discoveryUrl: `${baseUrl}/api/mcp/discovery`,
      wellKnownUrl: `${baseUrl}/.well-known/pact/mcp.json`,
      vmMcpUrl: `${vmBaseUrl}/mcp`
    },
    sharedHub: discovery?.sharedHub || null
  };
}

export function signMcpHandshake({ identity, payload }) {
  const privateKey = createPrivateKey({ key: identity.privateKeyJwk, format: "jwk" });
  return {
    algorithm: "Ed25519",
    payloadEncoding: "pact.stable-json.v1",
    value: sign(null, Buffer.from(stableStringify(payload)), privateKey).toString("base64url")
  };
}

export function verifyMcpHandshakeSignature({ publicKeyJwk, payload, signature }) {
  const publicKey = createPublicKey({ key: publicKeyJwk, format: "jwk" });
  return verify(
    null,
    Buffer.from(stableStringify(payload)),
    publicKey,
    Buffer.from(String(signature || ""), "base64url")
  );
}
