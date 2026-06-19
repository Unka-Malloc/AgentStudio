import { PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { asRecord, compactObject } from "../shared/records.js";

export function createVerificationFailure({
  layer = "core",
  code = "verification_failed",
  severity = "error",
  message = "",
  evidenceRef = "",
  repairable = false,
  details = {}
} = {}) {
  return compactObject({
    protocol: PACTIUM_PROTOCOL,
    layer,
    code,
    severity,
    message,
    evidenceRef,
    repairable,
    details: Object.keys(asRecord(details)).length > 0 ? asRecord(details) : undefined
  });
}

export class PactiumLifecycleError extends Error {
  constructor(message, failure) {
    super(message);
    this.name = "PactiumLifecycleError";
    this.failure = failure;
  }
}
