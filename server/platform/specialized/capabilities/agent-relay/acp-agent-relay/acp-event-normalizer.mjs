import {
  normalizeProgressEvent,
  normalizeReasoningTraceEvent,
  normalizeStopReason
} from "../../../../common/protocols/acp/index.mjs";

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

const SENSITIVE_KEY_PATTERN = /token|secret|password|credential|authorization|bearer|csrf|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|rawTranscript|rawPrompt|rawResponse/i;

function redactPayload(payload = {}) {
  const redactValue = (value, seen = new WeakSet()) => {
    if (typeof value === "string") {
      return value.length > 2000 ? `${value.slice(0, 2000)}...<truncated>` : value;
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    if (seen.has(value)) {
      return "<circular>";
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, seen));
    }
    const output = {};
    for (const [key, childValue] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "<redacted>" : redactValue(childValue, seen);
    }
    return output;
  };
  return redactValue(asObject(payload));
}

export class AcpEventNormalizer {
  progress(update = {}) {
    return {
      type: "progress",
      source: "target",
      redactedPayload: redactPayload(normalizeProgressEvent(update))
    };
  }

  reasoning(update = {}) {
    return {
      type: "reasoning_trace",
      source: "target",
      redactedPayload: redactPayload(normalizeReasoningTraceEvent(update))
    };
  }

  receipt(receipt = {}, source = "operation") {
    return {
      type: "receipt",
      source,
      redactedPayload: redactPayload({
        kind: "receipt",
        ...asObject(receipt)
      })
    };
  }

  denial(denial = {}, source = "policy") {
    return {
      type: "denial",
      source,
      redactedPayload: redactPayload({
        kind: "denial",
        ...asObject(denial)
      })
    };
  }

  completion(result = {}) {
    return {
      type: "completion",
      source: "target",
      redactedPayload: redactPayload({
        kind: "completion",
        stopReason: normalizeStopReason(result.stopReason || "completed"),
        outputSummary: result.outputSummary || result.text || "",
        targetError: asObject(result.targetError, null),
        receipts: Array.isArray(result.receipts) ? result.receipts : []
      })
    };
  }
}

export function createAcpEventNormalizer() {
  return new AcpEventNormalizer();
}
