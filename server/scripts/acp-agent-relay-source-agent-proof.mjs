function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeHelpText(value = "") {
  return asText(value).replace(/\r\n/g, "\n");
}

function commandListIncludes(helpText = "", commandName = "") {
  const text = normalizeHelpText(helpText);
  if (!text || !commandName) {
    return false;
  }
  return new RegExp(`(^|\\n)\\s{2,}${commandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|\\n|$)`).test(text);
}

export function codexCliSupportsAcpClientHelp(helpText = "", execHelpText = "") {
  const combined = `${normalizeHelpText(helpText)}\n${normalizeHelpText(execHelpText)}`.toLowerCase();
  return /(^|\s)--(?:experimental-)?acp(\s|,|$)/.test(combined) ||
    /(^|\n)\s{2,}acp(\s|\n|$)/.test(combined) ||
    /acp\s+(client|source)/.test(combined);
}

export function codexCliSupportsMcpServerHelp(helpText = "") {
  return commandListIncludes(helpText, "mcp-server");
}

function isActualCodexCliProcess(actualSourceProcess = "") {
  const text = asText(actualSourceProcess);
  return /(^|[/\s])codex(\s|$)/.test(text) && !text.includes("acp-agent-relay-source-stdio.mjs");
}

export function buildSourceAgentProof({
  requestedSourceLabel = "codex",
  actualSourceProcess = "",
  actualSourceTransport = "",
  codexCliPath = "",
  codexCliVersion = "",
  codexHelpText = "",
  codexExecHelpText = ""
} = {}) {
  const codexCliAcpClientSupported = codexCliSupportsAcpClientHelp(codexHelpText, codexExecHelpText);
  const actualSourceProcessText = asText(actualSourceProcess);
  const directCodexCliAcpSourceVerified = codexCliAcpClientSupported && isActualCodexCliProcess(actualSourceProcessText);
  const proofLevel = directCodexCliAcpSourceVerified
    ? "codex-cli-acp-source-verified"
    : codexCliAcpClientSupported
      ? "codex-cli-acp-source-supported-but-not-used"
      : "codex-orchestrated-source-acp-stdio";
  return {
    requestedSourceLabel: asText(requestedSourceLabel, "codex"),
    sourceAgentKind: directCodexCliAcpSourceVerified ? "codex-cli-acp-source" : "pact-source-acp-stdio-verifier",
    sourceMode: directCodexCliAcpSourceVerified ? "native" : "orchestrated_harness",
    proofLevel,
    directCodexCliAcpSourceVerified,
    codexCliPath: asText(codexCliPath),
    codexCliVersion: asText(codexCliVersion),
    codexCliAcpClientSupported,
    codexCliMcpServerSupported: codexCliSupportsMcpServerHelp(codexHelpText),
    actualSourceProcess: actualSourceProcessText,
    actualSourceTransport: asText(actualSourceTransport),
    caveat: directCodexCliAcpSourceVerified
      ? "Codex CLI is the actual source process and local help exposes ACP source/client support."
      : codexCliAcpClientSupported
      ? "Codex CLI appears to expose ACP-related help, but this verifier still uses Pact's source-facing ACP stdio harness unless the actual child process is codex."
      : "Codex CLI has no discovered ACP client/source mode in local help; this verifier is orchestrated by Codex and uses Pact's source-facing ACP stdio harness."
  };
}
