import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathIsWithinRoot } from "../../../../common/security/local-path-boundary.mjs";

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
    this.workspaceRoot = path.resolve(workspaceRoot);
    const providedFileSystem = asObject(fileSystem, {});
    this.fileSystem = {
      readFile: providedFileSystem.readFile || fs.readFile,
      writeFile: providedFileSystem.writeFile || fs.writeFile,
      mkdir: providedFileSystem.mkdir || fs.mkdir,
      lstat: providedFileSystem.lstat || fs.lstat,
      realpath: providedFileSystem.realpath || fs.realpath
    };
  }

  async resolveWorkspacePath(relativePath, { forWrite = false, expectedType = "" } = {}) {
    const absolutePath = path.resolve(this.workspaceRoot, relativePath);
    if (!pathIsWithinRoot(absolutePath, this.workspaceRoot)) {
      throw new Error("Workspace path escapes root.");
    }
    const rootStat = await this.fileSystem.lstat(this.workspaceRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error("Workspace root must be a regular directory.");
    }
    const rootRealPath = await this.fileSystem.realpath(this.workspaceRoot);

    if (!forWrite) {
      const stat = await this.fileSystem.lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error("Workspace path cannot be a symbolic link.");
      }
      if (expectedType === "file" && !stat.isFile()) {
        throw new Error("Workspace path must be a file.");
      }
      const realPath = await this.fileSystem.realpath(absolutePath);
      if (!pathIsWithinRoot(realPath, rootRealPath)) {
        throw new Error("Workspace real path escapes root.");
      }
      return { relativePath, absolutePath };
    }

    const segments = relativePath ? relativePath.split("/").filter(Boolean) : [];
    let current = this.workspaceRoot;
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      try {
        const stat = await this.fileSystem.lstat(current);
        if (stat.isSymbolicLink()) {
          throw new Error("Workspace write path cannot pass through a symbolic link directory.");
        }
        if (!stat.isDirectory()) {
          throw new Error("Workspace write parent must be a directory.");
        }
        const realPath = await this.fileSystem.realpath(current);
        if (!pathIsWithinRoot(realPath, rootRealPath)) {
          throw new Error("Workspace write parent escapes root.");
        }
      } catch (error) {
        if (error?.code === "ENOENT") {
          break;
        }
        throw error;
      }
    }

    try {
      const parentRealPath = await this.fileSystem.realpath(path.dirname(absolutePath));
      if (!pathIsWithinRoot(parentRealPath, rootRealPath)) {
        throw new Error("Workspace write parent escapes root.");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    try {
      const stat = await this.fileSystem.lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error("Workspace write path cannot be a symbolic link.");
      }
      const realPath = await this.fileSystem.realpath(absolutePath);
      if (!pathIsWithinRoot(realPath, rootRealPath)) {
        throw new Error("Workspace write path escapes root.");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    return { relativePath, absolutePath };
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
    let resolved;
    try {
      resolved = await this.resolveWorkspacePath(relativePath, { expectedType: "file" });
    } catch {
      return {
        ok: false,
        status: "denied",
        action: "fs.readTextFile",
        reasonCode: "path_denied",
        path: relativePath
      };
    }
    const content = await this.fileSystem.readFile(resolved.absolutePath, "utf8");
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
    let resolved;
    try {
      resolved = await this.resolveWorkspacePath(relativePath, { forWrite: true });
    } catch {
      return {
        ok: false,
        status: "denied",
        action: "fs.writeTextFile",
        reasonCode: "path_denied",
        path: relativePath,
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
    let beforeDigest = "";
    try {
      beforeDigest = sha256(await this.fileSystem.readFile(resolved.absolutePath, "utf8"));
    } catch {
      beforeDigest = "";
    }
    await this.fileSystem.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await this.fileSystem.writeFile(resolved.absolutePath, content, "utf8");
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
