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

function randomId(prefix = "agent_cli") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

const MAX_CLI_CAPTURE_BYTES = 256 * 1024;

function sanitizeText(value = "", limit = 12000) {
  return asText(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/((?:authorization|bearer|csrf|token|secret|password|credential|api[-_]?key)[\w.-]*\s*[:=]\s*)[^\s]+/gi, "$1<redacted>")
    .slice(0, limit);
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

function resolveCliConfig({ target = {}, relaySession = {} } = {}) {
  const transport = asObject(target.transport);
  const command = asObject(transport.command);
  return {
    executable: asText(command.executable || transport.binaryPath || transport.commandPath),
    cwd: asText(command.cwd || transport.cwd || relaySession.workspaceRoot || process.cwd()),
    env: {
      ...minimalCliEnv(process.env),
      ...asObject(command.env),
      ...asObject(transport.env)
    },
    args: asArray(command.args || transport.args).map(String),
    promptArgs: asArray(command.promptArgs || transport.promptArgs).map(String),
    promptDelivery: asText(command.promptDelivery || transport.promptDelivery, "argument"),
    timeoutMs: Number(command.timeoutMs || transport.timeoutMs || 0) || 240000
  };
}

function buildDelegatedPrompt(params = {}) {
  return asText(params.prompt || params.text || params.content);
}

function replacePromptPlaceholders(value = "", prompt = "") {
  return String(value)
    .replaceAll("{prompt}", prompt)
    .replaceAll("{text}", prompt)
    .replaceAll("{message}", prompt);
}

function hasPromptPlaceholder(values = []) {
  return asArray(values).some((value) => /\{(?:prompt|text|message)\}/.test(String(value)));
}

function cliArgsForPrompt(config = {}, prompt = "") {
  if (config.promptDelivery === "stdin" || config.promptDelivery === "none") {
    return [...config.args].map((arg) => replacePromptPlaceholders(arg, prompt));
  }
  const configuredArgs = [...config.args, ...config.promptArgs];
  const args = configuredArgs.map((arg) => replacePromptPlaceholders(arg, prompt));
  if (hasPromptPlaceholder(configuredArgs)) {
    return args;
  }
  return [...args, prompt];
}

async function writeTextIfPossible(filePath = "", text = "") {
  if (!filePath) {
    return;
  }
  await fs.writeFile(filePath, text, "utf8").catch(() => {});
}

export class AgentCliExecConnection {
  constructor(options = {}) {
    this.target = options.target || {};
    this.relaySession = options.relaySession || {};
    this.route = options.route || {};
    this.logger = options.logger || null;
    this.config = resolveCliConfig({ target: this.target, relaySession: this.relaySession });
    this.closed = false;
    this.initialized = false;
    this.messages = [];
    this.activeChild = null;
    this.targetSessionId = asText(this.relaySession.targetSessionId) ||
      `agent_cli_exec_${asText(this.relaySession.relaySessionId) || randomId("session")}`;
    this.targetResumeRef = asText(this.relaySession.targetResumeRef) || this.targetSessionId;
  }

  isReusable() {
    return this.closed !== true;
  }

  async initialize(params = {}) {
    if (!this.config.executable) {
      throw Object.assign(new Error("Local CLI fallback target requires transport.command.executable."), {
        code: "agent_cli_fallback_command_missing"
      });
    }
    this.initialized = true;
    this.messages.push({
      direction: "out",
      method: "agent-cli-exec.initialize",
      relaySessionId: asText(params.relaySessionId || this.relaySession.relaySessionId),
      targetSessionId: this.targetSessionId,
      at: nowIso()
    });
    return {
      ok: true,
      targetId: this.target.targetId || "",
      transportType: "agent-cli-exec",
      capabilities: {
        session: ["new"],
        updates: ["completed"],
        fs: [],
        terminal: false,
        mcp: false,
        cliFallback: true
      },
      targetSessionId: this.targetSessionId,
      targetResumeRef: this.targetResumeRef,
      initializedAt: nowIso(),
      metadata: {
        executable: path.basename(this.config.executable),
        promptDelivery: this.config.promptDelivery,
        policyDowngrade: true
      }
    };
  }

  async sendPrompt(params = {}) {
    if (this.closed) {
      throw Object.assign(new Error("Local CLI fallback target connection is closed."), {
        code: "target_connection_closed"
      });
    }
    if (!this.initialized) {
      await this.initialize(params);
    }
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-agent-cli-target-"));
    const outputPath = path.join(runRoot, "stdout.txt");
    const stderrPath = path.join(runRoot, "stderr.txt");
    const prompt = buildDelegatedPrompt(params);
    const args = cliArgsForPrompt(this.config, prompt);
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
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.activeChild = child;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Object.assign(new Error(`local CLI fallback target timed out after ${this.config.timeoutMs}ms.`), {
          code: "agent_cli_fallback_timeout"
        }));
      }, this.config.timeoutMs);
      if (this.config.promptDelivery === "stdin") {
        child.stdin.end(`${prompt}\n`, "utf8");
      } else {
        child.stdin.end();
      }
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
    await writeTextIfPossible(outputPath, stdout);
    await writeTextIfPossible(stderrPath, stderr);
    const text = stdout || stderr || "Local CLI fallback target completed without output.";
    const durationMs = Date.now() - startedAtMs;
    const ok = exitCode === 0;
    const completion = {
      type: "completion",
      stopReason: ok ? "completed" : "target_error",
      text,
      targetSessionId: this.targetSessionId,
      targetResumeRef: this.targetResumeRef,
      cliExitCode: exitCode,
      cliSignal: signal
    };
    this.messages.push({
      direction: "out",
      method: "agent-cli-exec",
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
        text: ok ? "Local CLI fallback target completed the delegated prompt." : "Local CLI fallback target returned a non-zero exit code."
      }],
      reasoning: [],
      stopReason: ok ? "completed" : "target_error",
      text,
      externalCompletionState: ok ? "completed" : "target_error",
      finalResponseAvailable: Boolean(text),
      finalResponsePolicy: ok ? "agent_cli_exec_stdout" : "target_error",
      targetError: ok ? null : {
        code: "agent_cli_fallback_failed",
        message: stderr || `local CLI fallback exited with ${(exitCode ?? signal) || "unknown"}.`
      },
      targetSessionId: this.targetSessionId,
      targetResumeRef: this.targetResumeRef,
      events: [{
        type: "progress",
        phase: ok ? "completed" : "target_error",
        text: ok ? "Local CLI fallback target completed." : "Local CLI fallback target failed."
      }, completion],
      externalResponse: {
        provider: "agent-cli-exec",
        executable: path.basename(this.config.executable),
        exitCode,
        signal,
        durationMs,
        outputPath,
        stderrPath
      },
      normalizedResponse: {
        provider: "agent-cli-exec",
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
      note: "Local CLI fallback target process was terminated when one was active."
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

export function createAgentCliExecConnection(options = {}) {
  return new AgentCliExecConnection(options);
}
