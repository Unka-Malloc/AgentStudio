import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeRelativePath(value = "") {
  const raw = asText(value).replaceAll("\\", "/");
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === ".." || path.isAbsolute(raw)) {
    return "";
  }
  return normalized;
}

export class AcpPermissionBridge {
  constructor({ workspaceRoot = process.cwd(), fileSystem = null } = {}) {
    this.workspaceRoot = workspaceRoot;
    this.fileSystem = fileSystem || {
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      mkdir: fs.mkdir
    };
  }

  denyTerminal(input = {}) {
    return {
      ok: false,
      status: "denied",
      action: "terminal",
      reasonCode: "phase1_terminal_denied",
      message: "ACP Agent Relay Phase 1 does not allow target terminal access.",
      requestedCommandHash: input.command ? sha256(input.command) : ""
    };
  }

  async readTextFile(input = {}) {
    const relativePath = normalizeRelativePath(input.path);
    if (!relativePath) {
      return {
        ok: false,
        status: "denied",
        action: "fs.readTextFile",
        reasonCode: "path_denied"
      };
    }
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    const content = await this.fileSystem.readFile(absolutePath, "utf8");
    return {
      ok: true,
      status: "completed",
      action: "fs.readTextFile",
      path: relativePath,
      content,
      digest: sha256(content)
    };
  }

  async requestWriteTextFile({ route = {}, write = {}, approval = {} } = {}) {
    const agent = asObject(route.virtualAgent);
    const writesPolicy = asText(route.decision?.writesPolicy?.writes || agent.capabilityPolicy?.writes, "deny");
    const maxRisk = asText(route.decision?.maxRisk || agent.capabilityPolicy?.maxRisk, "read_only");
    const relativePath = normalizeRelativePath(write.path);
    const content = String(write.content ?? "");
    const payloadHash = sha256(JSON.stringify({ path: relativePath, content }));
    if (!relativePath) {
      return {
        ok: false,
        status: "denied",
        action: "fs.writeTextFile",
        reasonCode: "path_denied",
        payloadHash
      };
    }
    if (writesPolicy === "deny") {
      return {
        ok: false,
        status: "denied",
        action: "fs.writeTextFile",
        reasonCode: "effective_policy_write_denied",
        path: relativePath,
        payloadHash
      };
    }
    if (maxRisk === "read_only" || maxRisk === "safe_write") {
      return {
        ok: false,
        status: "denied",
        action: "fs.writeTextFile",
        reasonCode: "effective_policy_risk_denied",
        path: relativePath,
        payloadHash,
        maxRisk
      };
    }
    if (approval.approved !== true) {
      return {
        ok: false,
        status: "pending_approval",
        action: "fs.writeTextFile",
        reasonCode: "approval_required",
        path: relativePath,
        payloadHash
      };
    }
    if (approval.payloadHash && approval.payloadHash !== payloadHash) {
      return {
        ok: false,
        status: "denied",
        action: "fs.writeTextFile",
        reasonCode: "approval_payload_mismatch",
        path: relativePath,
        payloadHash,
        approvedPayloadHash: approval.payloadHash
      };
    }
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    let beforeDigest = "";
    try {
      beforeDigest = sha256(await this.fileSystem.readFile(absolutePath, "utf8"));
    } catch {
      beforeDigest = "";
    }
    await this.fileSystem.mkdir(path.dirname(absolutePath), { recursive: true });
    await this.fileSystem.writeFile(absolutePath, content, "utf8");
    return {
      ok: true,
      status: "completed",
      action: "fs.writeTextFile",
      path: relativePath,
      beforeDigest,
      afterDigest: sha256(content),
      payloadHash,
      approvalId: asText(approval.approvalId, "approval-inline")
    };
  }
}

export function createAcpPermissionBridge(options = {}) {
  return new AcpPermissionBridge(options);
}
