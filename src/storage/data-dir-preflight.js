import fs from "node:fs";
import path from "node:path";
import {
  PACTIUM_PACKAGE_VERSION,
  PACTIUM_PROTOCOL,
  PACTIUM_SCHEMA_VERSION
} from "../protocol/constants.js";
import { resolveDataDir } from "./local-json-storage-port.js";

export const PACTIUM_MANIFEST_FILE = "pactium-manifest.json";
export const PACTIUM_SQLITE_FILE = "pactium.sqlite";
export const PROTOCOL_STORAGE_CATEGORY = "protocol-substrate";

function readJsonSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Classify a data-directory-relative path as Pactium protocol substrate storage
 * or return an empty string when the path is outside that surface.
 */
export function classifyProtocolStorageArtifact(relativePath = "") {
  const value = String(relativePath || "").replace(/\\/g, "/");
  if (
    value === PACTIUM_MANIFEST_FILE ||
    value === PACTIUM_SQLITE_FILE ||
    value === `${PACTIUM_SQLITE_FILE}-wal` ||
    value === `${PACTIUM_SQLITE_FILE}-shm` ||
    value.startsWith("cas/") ||
    value.startsWith("protocol/")
  ) {
    return PROTOCOL_STORAGE_CATEGORY;
  }
  return "";
}

/**
 * Inspect whether a data directory is empty or already bound to the current
 * Pactium protocol and schema. Non-current manifests are rejected findings.
 */
export function inspectDataDir({ dataDir = "", userDataPath = "" } = {}) {
  const resolvedDataDir = resolveDataDir(dataDir || userDataPath || "");
  const manifestPath = path.join(resolvedDataDir, PACTIUM_MANIFEST_FILE);
  const manifest = readJsonSync(manifestPath);
  const findings = [];

  if (manifest && (manifest.protocol !== PACTIUM_PROTOCOL || manifest.schema !== PACTIUM_SCHEMA_VERSION)) {
    findings.push({
      kind: "non-current-pactium-manifest",
      path: manifestPath,
      detail: `${manifest.protocol || "unknown"}:${manifest.schema || "unknown"}`
    });
  }

  return {
    ok: findings.length === 0,
    dataDir: resolvedDataDir,
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    packageVersion: PACTIUM_PACKAGE_VERSION,
    findings
  };
}

/**
 * Throw when inspectDataDir reports a non-current Pactium directory.
 */
export function assertCurrentDataDir(input = {}) {
  const result = inspectDataDir(input);
  if (result.ok) {
    return result;
  }
  const detail = result.findings
    .map((finding) => `${finding.kind}: ${finding.path}`)
    .join("; ");
  throw new Error(
    `Pactium ${PACTIUM_PACKAGE_VERSION} requires a current Pactium data directory (${detail}).`
  );
}
