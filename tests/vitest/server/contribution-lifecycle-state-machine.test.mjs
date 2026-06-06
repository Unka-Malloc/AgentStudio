import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import {
  validateStateMachineDefinition,
  transitionState,
  assertTransitionAllowed
} from "../../../server/platform/common/state-machine/state-machine-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defPath = path.resolve(__dirname, "../../../server/platform/common/state-machine/definitions/contribution.lifecycle.v1.json");

describe("Contribution Lifecycle State Machine", () => {
  let definition;

  beforeAll(async () => {
    const raw = await fs.readFile(defPath, "utf8");
    definition = JSON.parse(raw);
  });

  it("should pass schema and core validation checks", () => {
    const validation = validateStateMachineDefinition(definition);
    expect(validation.ok).toBe(true);
    expect(definition.machineId).toBe("contribution.lifecycle.v1");
    expect(definition.initialState).toBe("submitted");
  });

  it("should transition successfully through the main legal pathway", () => {
    // 1. submitted -> preview
    let res = transitionState(definition, {
      entityId: "contrib-1",
      currentStatus: "submitted",
      eventType: "contribution.preview"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("preview");

    // 2. preview -> scanned
    res = transitionState(definition, {
      entityId: "contrib-1",
      currentStatus: "preview",
      eventType: "contribution.scan_passed"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("scanned");

    // 3. scanned -> reviewed
    res = transitionState(definition, {
      entityId: "contrib-1",
      currentStatus: "scanned",
      eventType: "contribution.review_approved"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("reviewed");

    // 4. reviewed -> published
    res = transitionState(definition, {
      entityId: "contrib-1",
      currentStatus: "reviewed",
      eventType: "contribution.publish"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("published");

    // 5. published -> adopted
    res = transitionState(definition, {
      entityId: "contrib-1",
      currentStatus: "published",
      eventType: "contribution.adopt"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("adopted");

    // 6. adopted -> deprecated
    res = transitionState(definition, {
      entityId: "contrib-1",
      currentStatus: "adopted",
      eventType: "contribution.deprecate"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("deprecated");

    // 7. deprecated -> revoked
    res = transitionState(definition, {
      entityId: "contrib-1",
      currentStatus: "deprecated",
      eventType: "contribution.revoke"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("revoked");
  });

  it("should handle alternative branches (preview -> scan failed -> rejected)", () => {
    // 1. submitted -> preview
    let res = transitionState(definition, {
      entityId: "contrib-2",
      currentStatus: "submitted",
      eventType: "contribution.preview"
    });
    expect(res.ok).toBe(true);

    // 2. preview -> rejected via scan failed
    res = transitionState(definition, {
      entityId: "contrib-2",
      currentStatus: "preview",
      eventType: "contribution.scan_failed"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("rejected");
  });

  it("should handle alternative branches (scanned -> needs_changes -> preview/submitted)", () => {
    // 1. scanned -> needs_changes
    let res = transitionState(definition, {
      entityId: "contrib-3",
      currentStatus: "scanned",
      eventType: "contribution.changes_requested"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("needs_changes");

    // 2a. needs_changes -> preview
    res = transitionState(definition, {
      entityId: "contrib-3",
      currentStatus: "needs_changes",
      eventType: "contribution.preview"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("preview");

    // 2b. needs_changes -> submitted
    res = transitionState(definition, {
      entityId: "contrib-3",
      currentStatus: "needs_changes",
      eventType: "contribution.submit"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("submitted");
  });

  it("should reject illegal transitions with structured error codes", () => {
    // published cannot be reached directly from submitted
    let res = transitionState(definition, {
      entityId: "contrib-4",
      currentStatus: "submitted",
      eventType: "contribution.publish"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("CONTRIBUTION_PUBLISH_BEFORE_REVIEW");

    // adopted cannot be reached before published
    res = transitionState(definition, {
      entityId: "contrib-4",
      currentStatus: "submitted",
      eventType: "contribution.adopt"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("CONTRIBUTION_NOT_PUBLISHED");

    // scan_passed cannot run from submitted directly without preview
    res = transitionState(definition, {
      entityId: "contrib-4",
      currentStatus: "submitted",
      eventType: "contribution.scan_passed"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("CONTRIBUTION_NOT_PREVIEWED");
  });

  it("should enforce terminal state boundary conditions (rejected)", () => {
    // Try to transition out of rejected
    const res = transitionState(definition, {
      entityId: "contrib-5",
      currentStatus: "rejected",
      eventType: "contribution.submit"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("CONTRIBUTION_TERMINAL_REJECTED");
  });

  it("should enforce terminal state boundary conditions (revoked)", () => {
    // Try to transition out of revoked
    const res = transitionState(definition, {
      entityId: "contrib-6",
      currentStatus: "revoked",
      eventType: "contribution.submit"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("CONTRIBUTION_TERMINAL_REVOKED");
  });

  it("should handle idempotent events correctly", () => {
    // submitted + submit
    let res = transitionState(definition, {
      entityId: "contrib-7",
      currentStatus: "submitted",
      eventType: "contribution.submit"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("submitted");

    // published + publish
    res = transitionState(definition, {
      entityId: "contrib-7",
      currentStatus: "published",
      eventType: "contribution.publish"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("published");

    // rejected + review_rejected (idempotent reject)
    res = transitionState(definition, {
      entityId: "contrib-7",
      currentStatus: "rejected",
      eventType: "contribution.review_rejected"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("rejected");

    // revoked + revoke (idempotent revoke)
    res = transitionState(definition, {
      entityId: "contrib-7",
      currentStatus: "revoked",
      eventType: "contribution.revoke"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("revoked");
  });
});
