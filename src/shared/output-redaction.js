import os from "node:os";
import path from "node:path";

export const REDACTED_LOCAL_HOST = "<redacted:local-host>";
export const REDACTED_LOCAL_PATH = "<redacted:local-path>";
export const REDACTED_LOCAL_USER = "<redacted:local-user>";
export const REDACTED_PROCESS = "<redacted:process>";
export const REDACTED_SECRET = "<redacted:secret>";

const SENSITIVE_KEY_NAMES = new Set([
  "apikey",
  "apikeys",
  "accesskey",
  "accesskeys",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "fencingtoken",
  "password",
  "passwords",
  "passphrase",
  "passphrases",
  "privatekey",
  "privatekeys",
  "processstartkey",
  "secret",
  "secretkey",
  "secrets",
  "sessiontoken",
  "signersecret",
  "token",
  "tokens"
]);

const SAFE_KEY_NAMES = new Set([
  "key",
  "keyrange",
  "idempotencykey",
  "outcomeidempotencykey",
  "publickey"
]);

const PATH_KEY_NAMES = new Set([
  "absolutepath",
  "cwd",
  "databasepath",
  "datadir",
  "dir",
  "filepath",
  "homedir",
  "lockpath",
  "manifestpath",
  "path",
  "userdata",
  "userdatapath"
]);

const USER_KEY_NAMES = new Set([
  "owner",
  "user",
  "username"
]);

const HOST_KEY_NAMES = new Set([
  "host",
  "hostname"
]);

const PROCESS_KEY_NAMES = new Set([
  "pid",
  "processid"
]);

const SECRET_ASSIGNMENT_PATTERN = /\b(api[-_]?key|access[-_]?key|authorization|cookie|password|passphrase|private[-_]?key|secret|token)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const LOCAL_IDENTITY_ASSIGNMENT_PATTERN = /\b(host(?:name)?|owner|user(?:name)?)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const GENERIC_LOCAL_PATH_PATTERN = /(^|[\s([{=:])((?:~[/\\]|[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp|var|Volumes|etc|opt|usr)[/\\])[^"'`\s,)}\]]*)/g;

function normalizedKey(key) {
  return String(key || "").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localIdentity() {
  let username = "";
  try {
    username = os.userInfo().username || "";
  } catch {
    username = "";
  }
  return {
    hostname: os.hostname() || "",
    username
  };
}

function localPathPrefixes() {
  const prefixes = [
    os.homedir(),
    os.tmpdir(),
    process.cwd()
  ].filter(Boolean);
  return [...new Set(prefixes.map((prefix) => path.resolve(prefix)).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
}

function isSensitiveKey(key) {
  const name = normalizedKey(key);
  if (!name || SAFE_KEY_NAMES.has(name)) return false;
  if (SENSITIVE_KEY_NAMES.has(name)) return true;
  return name.includes("secret") ||
    name.includes("password") ||
    name.includes("passphrase") ||
    name.includes("credential") ||
    name.includes("authorization") ||
    name.includes("cookie") ||
    name.endsWith("token") ||
    name.endsWith("tokens") ||
    name.endsWith("apikey") ||
    name.endsWith("apikeys") ||
    name.endsWith("accesskey") ||
    name.endsWith("accesskeys") ||
    name.endsWith("privatekey") ||
    name.endsWith("privatekeys");
}

function isPathKey(key) {
  return PATH_KEY_NAMES.has(normalizedKey(key));
}

function isUserKey(key) {
  return USER_KEY_NAMES.has(normalizedKey(key));
}

function isHostKey(key) {
  return HOST_KEY_NAMES.has(normalizedKey(key));
}

function isProcessKey(key) {
  return PROCESS_KEY_NAMES.has(normalizedKey(key));
}

function looksLikeLocalPath(value) {
  const text = String(value || "");
  if (!text) return false;
  const normalized = text.replace(/\\/g, "/");
  if (/^~(?:\/|$)/.test(normalized) || /^[A-Za-z]:\//.test(normalized)) return true;
  if (/^\/(?:Users|home|private|tmp|var|Volumes|etc|opt|usr)(?:\/|$)/.test(normalized)) return true;
  return localPathPrefixes().some((prefix) => {
    const localPrefix = prefix.replace(/\\/g, "/");
    return normalized === localPrefix || normalized.startsWith(`${localPrefix}/`);
  });
}

export function redactLocalString(value, key = "") {
  let output = String(value);
  const identity = localIdentity();

  output = output.replace(PRIVATE_KEY_BLOCK_PATTERN, REDACTED_SECRET);
  output = output.replace(SECRET_ASSIGNMENT_PATTERN, (_match, name, separator) =>
    `${name}${separator}${REDACTED_SECRET}`);
  output = output.replace(LOCAL_IDENTITY_ASSIGNMENT_PATTERN, (match, name, separator, rawValue) => {
    const assignmentValue = String(rawValue || "").replace(/^["']|["']$/g, "");
    const normalizedName = normalizedKey(name);
    if (identity.username && ["owner", "user", "username"].includes(normalizedName) && assignmentValue === identity.username) {
      return `${name}${separator}${REDACTED_LOCAL_USER}`;
    }
    if (identity.hostname && ["host", "hostname"].includes(normalizedName) && assignmentValue === identity.hostname) {
      return `${name}${separator}${REDACTED_LOCAL_HOST}`;
    }
    return match;
  });

  for (const prefix of localPathPrefixes()) {
    const escaped = escapeRegExp(prefix.replace(/\\/g, "/"));
    const pattern = new RegExp(`${escaped}(?:[/\\\\][^"'\\s,)}\\]]*)?`, "g");
    output = output.replace(pattern, REDACTED_LOCAL_PATH);
  }
  output = output.replace(GENERIC_LOCAL_PATH_PATTERN, (_match, lead) => `${lead}${REDACTED_LOCAL_PATH}`);

  if (isPathKey(key) && looksLikeLocalPath(output)) return REDACTED_LOCAL_PATH;
  if (identity.username && isUserKey(key) && output === identity.username) return REDACTED_LOCAL_USER;
  if (identity.hostname && isHostKey(key) && output === identity.hostname) return REDACTED_LOCAL_HOST;
  return output;
}

export function redactLocalOutput(value, key = "", seen = new WeakMap()) {
  if (isSensitiveKey(key)) return REDACTED_SECRET;
  if (typeof value === "string") return redactLocalString(value, key);
  if (typeof value === "number" && isProcessKey(key) && value === process.pid) return REDACTED_PROCESS;
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const redacted = [];
    seen.set(value, redacted);
    for (const item of value) redacted.push(redactLocalOutput(item, key, seen));
    return redacted;
  }
  const redacted = {};
  seen.set(value, redacted);
  for (const [entryKey, entryValue] of Object.entries(value)) {
    redacted[entryKey] = redactLocalOutput(entryValue, entryKey, seen);
  }
  return redacted;
}
