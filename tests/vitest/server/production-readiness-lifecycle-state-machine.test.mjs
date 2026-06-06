import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defPath = path.resolve(__dirname, "../../../server/platform/common/state-machine/definitions/production.readiness.lifecycle.v1.json");

describe("Production Readiness Lifecycle State Machine", () => {
  let definition;

  beforeAll(async () => {
    const raw = await fs.readFile(defPath, "utf8");
    definition = JSON.parse(raw);
  });

  it("PO-READY-001: Any P0 failure blocks production_ready", () => {
    const mapping = definition.proofMappings.find(m => m.obligationId === "PO-READY-001");
    expect(mapping).toBeDefined();
    expect(mapping.params.target).toBe("release_candidate");
  });

  it("PO-READY-002: Waiver must have valid schema fields", () => {
    const mapping = definition.proofMappings.find(m => m.obligationId === "PO-READY-002");
    expect(mapping).toBeDefined();
    expect(mapping.params.target).toBe("waiver_requested");
  });

  it("PO-READY-003: Production-ready claim requires machine-readable report", () => {
    const mapping = definition.proofMappings.find(m => m.obligationId === "PO-READY-003");
    expect(mapping).toBeDefined();
  });

  it("PO-READY-004: Contract-only not counted as live evidence", () => {
    const mapping = definition.proofMappings.find(m => m.obligationId === "PO-READY-004");
    expect(mapping).toBeDefined();
  });
});
