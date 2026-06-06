const STOP_REASON_ALIASES = Object.freeze({
  complete: "completed",
  done: "completed",
  stopped: "stopped",
  finished: "completed",
  canceled: "cancelled",
  interrupted: "cancelled",
  timed_out: "timeout",
  timeout: "timeout",
  max_turns_reached: "max_turns",
  max_turns: "max_turns",
  error: "error",
  failed: "error"
});

function pickText(event = {}, fallback = "") {
  return [
    event.text,
    event.message,
    event.output,
    event.content,
    event.detail,
    fallback
  ].find((value) => typeof value === "string" && value.trim().length > 0) || "";
}

function normalizeReasoningReason(value) {
  if (value == null) {
    return "reasoning";
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return String(value?.reason || value?.type || value?.name || "reasoning");
}

export function normalizeProgressEvent(event = {}) {
  return {
    kind: "progress",
    phase: event.phase || event.stage || event.name || null,
    text: pickText(event, "Progress update"),
    progress: typeof event.progress === "number" ? event.progress : undefined,
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : undefined
  };
}

export function normalizeReasoningTraceEvent(event = {}) {
  return {
    kind: "reasoning_trace",
    reason: normalizeReasoningReason(event),
    text: pickText(event, "Reasoning trace"),
    model: event.model || event.provider || undefined,
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : undefined
  };
}

export function normalizeStopReason(stopReason = "") {
  const raw = (() => {
    if (typeof stopReason === "string") return stopReason;
    if (stopReason && typeof stopReason === "object") {
      return stopReason.code || stopReason.reason || stopReason.type || stopReason.reasonCode || "";
    }
    return "";
  })();

  const normalized = String(raw || "").trim().toLowerCase().replace(/-/g, "_");
  const finalReason = STOP_REASON_ALIASES[normalized] || normalized || "completed";

  return {
    reason: finalReason,
    raw: stopReason
  };
}
