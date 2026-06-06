function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function textFromBlock(block = {}) {
  if (typeof block === "string") {
    return block;
  }
  const input = asObject(block, null);
  if (!input) {
    return "";
  }
  if (typeof input.text === "string") {
    return input.text;
  }
  if (typeof input.content === "string") {
    return input.content;
  }
  if (typeof input.value === "string") {
    return input.value;
  }
  return "";
}

export function extractAcpPromptText(params = {}) {
  const input = asObject(params);
  const prompt = input.prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map((block) => textFromBlock(block))
      .filter((text) => text.trim().length > 0)
      .join("\n")
      .trim();
  }
  if (typeof prompt === "object" && prompt !== null) {
    const nestedText = textFromBlock(prompt);
    if (nestedText.trim()) {
      return nestedText.trim();
    }
    if (Array.isArray(prompt.content)) {
      return extractAcpPromptText({ prompt: prompt.content });
    }
  }
  return asText(prompt || input.text || input.message || input.content);
}

export function createAcpTextPromptBlocks(value = "") {
  const text = extractAcpPromptText({ prompt: value });
  return text ? [{ type: "text", text }] : [];
}

export function normalizeAcpStopReason(stopReason = "") {
  const raw = asText(
    typeof stopReason === "object" && stopReason
      ? stopReason.reason || stopReason.code || stopReason.type || stopReason.reasonCode
      : stopReason,
    "completed"
  );
  switch (raw) {
    case "completed":
    case "accepted":
      return "end_turn";
    case "approval_pending":
      return "wait_for_permission";
    case "approval_denied":
    case "target_error":
    case "error":
    case "failed":
      return "refusal";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return raw || "end_turn";
  }
}

export function createAcpSessionUpdateParams(update = {}) {
  const input = asObject(update);
  const payload = asObject(input.payload);
  const text = asText(input.text || input.message || payload.text || payload.outputSummary || payload.message);
  const kind = asText(input.type || input.kind || payload.type, "progress");
  const phase = asText(input.phase || payload.phase || payload.stopReason?.reason);
  const sessionUpdate = text ? "agent_message_chunk" : kind;
  return {
    sessionId: asText(input.sessionId || input.relaySessionId),
    update: {
      sessionUpdate,
      ...(text ? { content: { type: "text", text }, text } : {}),
      ...(phase ? { status: phase } : {}),
      _meta: {
        pact: {
          relaySessionId: asText(input.relaySessionId || input.sessionId),
          turnId: asText(input.turnId),
          eventId: asText(input.eventId),
          sequence: Number(input.sequence || 0),
          source: asText(input.source, "target"),
          phase,
          type: kind,
          payload
        }
      }
    },
    ...input
  };
}
