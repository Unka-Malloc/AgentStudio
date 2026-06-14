import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeText(value = "", limit = 12000) {
  return asText(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/((?:authorization|bearer|csrf|token|secret|password|credential|api[-_]?key)[\w.-]*\s*[:=]\s*)[^\s]+/gi, "$1<redacted>")
    .slice(0, limit);
}

function minimalCliEnv(env = process.env) {
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TERM_PROGRAM"
  ];
  const result = {};
  for (const key of allowed) {
    if (env[key] !== undefined) {
      result[key] = env[key];
    }
  }
  return result;
}

function randomId(prefix = "codex_exec") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

const MAX_CLI_CAPTURE_BYTES = 256 * 1024;

function resolveCodexConfig({ target = {}, relaySession = {} } = {}) {
  const transport = asObject(target.transport);
  const command = asObject(transport.command);
  const metadata = asObject(target.metadata?.public || target.metadata?.safe || target.metadata);
  const degraded = transport.degraded === true || metadata.degraded === true;
  return {
    executable: asText(command.executable || transport.binaryPath || transport.commandPath || process.env.PACT_CODEX_CLI_PATH || "codex"),
    cwd: asText(command.cwd || transport.cwd || relaySession.workspaceRoot || process.cwd()),
    env: {
      ...(degraded ? minimalCliEnv(process.env) : process.env),
      ...asObject(command.env),
      ...asObject(transport.env)
    },
    model: asText(command.model || transport.model || process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_MODEL),
    sandbox: asText(command.sandbox || transport.sandbox || process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_SANDBOX, "read-only"),
    timeoutMs: Number(command.timeoutMs || transport.timeoutMs || process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_TIMEOUT_MS || 0) || 240000,
    extraArgs: asArray(command.args || transport.args).map((item) => String(item)),
    bypassSandbox: command.bypassSandbox === true ||
      transport.bypassSandbox === true ||
      process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_BYPASS_SANDBOX === "1",
    ignoreRules: command.ignoreRules === true || transport.ignoreRules === true,
    ignoreUserConfig: command.ignoreUserConfig === true || transport.ignoreUserConfig === true,
    skipGitRepoCheck: command.skipGitRepoCheck !== false && transport.skipGitRepoCheck !== false,
    degraded
  };
}

function buildCodexTargetPrompt(params = {}, { target = {}, relaySession = {}, route = {} } = {}) {
  const prompt = asText(params.prompt || params.text || params.content);
  const metadataLines = [
    "[Pact ACP Agent Relay] You are being invoked as a Codex CLI target agent through Pact.",
    `relaySessionId: ${asText(params.relaySessionId || relaySession.relaySessionId)}`,
    `relayTurnId: ${asText(params.relayTurnId)}`,
    `virtualAgentId: ${asText(params.virtualAgentId || route.virtualAgent?.virtualAgentId)}`,
    `targetId: ${asText(params.targetId || target.targetId)}`,
    `mode: ${asText(params.mode || route.effectiveMode, "ask")}`,
    "Follow the delegated task. Do not reveal hidden credentials or raw transport headers.",
    "Unless the task explicitly requires edits and policy permits them, do not modify files."
  ];
  return `${metadataLines.join("\n")}\n\n${prompt}`;
}

function codexExecArgs({ config, prompt, outputPath }) {
  const args = [
    "exec",
    "--cd",
    config.cwd,
    "--output-last-message",
    outputPath,
    "--json"
  ];
  if (config.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }
  if (config.model) {
    args.push("--model", config.model);
  }
  if (config.ignoreRules) {
    args.push("--ignore-rules");
  }
  if (config.ignoreUserConfig) {
    args.push("--ignore-user-config");
  }
  if (config.bypassSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (config.sandbox) {
    args.push("--sandbox", config.sandbox);
  }
  args.push(...config.extraArgs, prompt);
  return args;
}

async function readFileText(filePath = "") {
  try {
    const stat = await fs.stat(filePath);
    const size = Number(stat.size || 0);
    const handle = await fs.open(filePath, "r");
    try {
      const readSize = Math.min(size, MAX_CLI_CAPTURE_BYTES);
      const buffer = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
      const suffix = size > MAX_CLI_CAPTURE_BYTES
        ? `\n...[truncated ${size - MAX_CLI_CAPTURE_BYTES} bytes]`
        : "";
      return `${buffer.subarray(0, bytesRead).toString("utf8")}${suffix}`;
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

function createBoundedCapture(maxBytes = MAX_CLI_CAPTURE_BYTES) {
  const chunks = [];
  let capturedBytes = 0;
  let truncatedBytes = 0;
  return {
    push(chunk) {
      const buffer = Buffer.from(chunk);
      const remaining = Math.max(0, maxBytes - capturedBytes);
      if (capturedBytes < maxBytes) {
        const slice = buffer.subarray(0, remaining);
        chunks.push(slice);
        capturedBytes += slice.byteLength;
      }
      if (buffer.byteLength > remaining) {
        truncatedBytes += buffer.byteLength - remaining;
      }
    },
    text() {
      const suffix = truncatedBytes > 0 ? `\n...[truncated ${truncatedBytes} bytes]` : "";
      return `${Buffer.concat(chunks).toString("utf8")}${suffix}`;
    }
  };
}

export class CodexCliExecConnection {
  constructor(options = {}) {
    this.target = options.target || {};
    this.relaySession = options.relaySession || {};
    this.route = options.route || {};
    this.logger = options.logger || null;
    this.config = resolveCodexConfig({ target: this.target, relaySession: this.relaySession });
    this.closed = false;
    this.initialized = false;
    this.messages = [];
    this.activeChild = null;
    this.targetSessionId = asText(this.relaySession.targetSessionId) || `codex_cli_exec_${asText(this.relaySession.relaySessionId) || randomId("session")}`;
    this.targetResumeRef = asText(this.relaySession.targetResumeRef) || this.targetSessionId;
  }

  isReusable() {
    return this.closed !== true;
  }

  async initialize(params = {}) {
    this.initialized = true;
    this.messages.push({
      direction: "out",
      method: "codex.exec.initialize",
      relaySessionId: asText(params.relaySessionId || this.relaySession.relaySessionId),
      targetSessionId: this.targetSessionId,
      at: nowIso()
    });
    return {
      ok: true,
      targetId: this.target.targetId || "",
      transportType: "codex-cli-exec",
      capabilities: {
        session: ["new"],
        updates: ["completed"],
        fs: [],
        terminal: false,
        mcp: false,
        codexCli: true
      },
      targetSessionId: this.targetSessionId,
      targetResumeRef: this.targetResumeRef,
      initializedAt: nowIso(),
      metadata: {
        executable: path.basename(this.config.executable),
        sandbox: this.config.bypassSandbox ? "bypass" : this.config.sandbox,
        model: this.config.model,
        policyDowngrade: this.config.degraded === true
      }
    };
  }

  async sendPrompt(params = {}) {
    if (this.closed) {
      throw Object.assign(new Error("Codex CLI target connection is closed."), { code: "target_connection_closed" });
    }
    if (!this.initialized) {
      await this.initialize(params);
    }
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-codex-cli-target-"));
    const outputPath = path.join(runRoot, "last-message.txt");
    const eventLogPath = path.join(runRoot, "codex-events.jsonl");
    const prompt = buildCodexTargetPrompt(params, {
      target: this.target,
      relaySession: this.relaySession,
      route: this.route
    });
    const args = codexExecArgs({ config: this.config, prompt, outputPath });
    const startedAt = nowIso();
    const startedAtMs = Date.now();
    const stdoutCapture = createBoundedCapture();
    const stderrCapture = createBoundedCapture();
    let exitCode = null;
    let signal = "";
    await new Promise((resolve, reject) => {
      const child = spawn(this.config.executable, args, {
        cwd: this.config.cwd,
        env: this.config.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.activeChild = child;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Object.assign(new Error(`codex exec target timed out after ${this.config.timeoutMs}ms.`), {
          code: "codex_cli_target_timeout"
        }));
      }, this.config.timeoutMs);
      child.stdout.on("data", (chunk) => stdoutCapture.push(chunk));
      child.stderr.on("data", (chunk) => stderrCapture.push(chunk));
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, childSignal) => {
        clearTimeout(timeout);
        exitCode = Number.isFinite(Number(code)) ? Number(code) : null;
        signal = asText(childSignal);
        resolve();
      });
    }).finally(() => {
      this.activeChild = null;
    });
    const stdout = sanitizeText(stdoutCapture.text());
    const stderr = sanitizeText(stderrCapture.text());
    await fs.writeFile(eventLogPath, stdout, "utf8").catch(() => {});
    const lastMessage = sanitizeText(await readFileText(outputPath));
    const text = lastMessage || stdout || stderr || "Codex CLI target completed without a final message.";
    const durationMs = Date.now() - startedAtMs;
    const ok = exitCode === 0;
    const completion = {
      type: "completion",
      stopReason: ok ? "completed" : "target_error",
      text,
      targetSessionId: this.targetSessionId,
      targetResumeRef: this.targetResumeRef,
      codexExitCode: exitCode,
      codexSignal: signal
    };
    this.messages.push({
      direction: "out",
      method: "codex.exec",
      relaySessionId: asText(params.relaySessionId || this.relaySession.relaySessionId),
      relayTurnId: asText(params.relayTurnId),
      targetSessionId: this.targetSessionId,
      exitCode,
      signal,
      durationMs,
      at: startedAt
    });
    return {
      ok,
      updates: [{
        type: "progress",
        phase: ok ? "completed" : "target_error",
        text: ok ? "Codex CLI target completed the delegated prompt." : "Codex CLI target returned a non-zero exit code."
      }],
      reasoning: [],
      stopReason: ok ? "completed" : "target_error",
      text,
      externalCompletionState: ok ? "completed" : "target_error",
      finalResponseAvailable: Boolean(text),
      finalResponsePolicy: ok ? "codex_cli_exec_final_message" : "target_error",
      targetError: ok ? null : {
        code: "codex_cli_target_failed",
        message: stderr || `codex exec exited with ${(exitCode ?? signal) || "unknown"}.`
      },
      targetSessionId: this.targetSessionId,
      targetResumeRef: this.targetResumeRef,
      conversation: {
        targetSessionId: this.targetSessionId,
        model: this.config.model,
        summary: text,
        stopReason: ok ? "completed" : "target_error"
      },
      events: [{
        type: "progress",
        phase: ok ? "completed" : "target_error",
        text: ok ? "Codex CLI target completed." : "Codex CLI target failed."
      }, completion],
      externalResponse: {
        provider: "codex-cli-exec",
        executable: path.basename(this.config.executable),
        exitCode,
        signal,
        durationMs,
        outputPath,
        eventLogPath
      },
      normalizedResponse: {
        provider: "codex-cli-exec",
        text,
        stdout,
        stderr,
        exitCode,
        signal
      }
    };
  }

  async cancel() {
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill("SIGTERM");
    }
    return {
      ok: true,
      cancelledAt: nowIso(),
      note: "Codex CLI target process was terminated when one was active."
    };
  }

  async close() {
    this.closed = true;
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill("SIGTERM");
    }
    return {
      ok: true,
      closedAt: nowIso()
    };
  }
}

export function createCodexCliExecConnection(options = {}) {
  return new CodexCliExecConnection(options);
}
