import { describe, expect, it } from "vitest";
import {
  SERVER_API_OPERATIONS,
  buildApiPathForCliOperation,
  findCliOperation,
  formatInterfaceCatalogMarkdown,
  getCliEntries,
  listInterfaceCatalog
} from "../../../server/platform/common/operation-dispatcher/operation-registry.mjs";

function operationFixture(overrides = {}) {
  return {
    id: "fixture.item.get",
    feature: "fixture",
    label: "Fixture | Item",
    target: { controller: "fixture", method: "handleItem" },
    http: {
      method: "GET",
      path: "/api/fixture/:itemId/:childId",
      localInForwardMode: true,
      query: [
        { name: "tag", aliases: ["tag", "tags"] },
        { name: "mode", aliases: ["mode"] },
        { name: "empty", aliases: ["empty"] }
      ]
    },
    rpc: { method: "fixture.item.get" },
    cli: {
      command: [" fixture ", "item", "", "get"],
      aliases: [["fix", "get"], ["fixture", "read"]],
      usage: "fixture item get --item-id ID",
      pathParams: {
        itemId: ["item-id", "id"],
        childId: ["child-id"]
      }
    },
    aspects: ["fixture"],
    requiredScopes: ["fixture:read"],
    readOnly: true,
    concurrencySafe: true,
    audit: { write: false },
    log: { level: "debug" },
    safety: { risk: "read_only" },
    inputSchema: { type: "object" },
    ...overrides
  };
}

describe("operation registry exported helpers", () => {
  it("lists catalog rows with serializable safety and escaped markdown cells", () => {
    const rows = listInterfaceCatalog([
      operationFixture({
        deprecated: true,
        replacementService: "external.fixture",
        replacementOperationPrefix: "external.fixture.",
        lifecycle: { status: "deprecated" },
        binary: true,
        destructive: true,
        public: true,
        externalAuth: true
      })
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        id: "fixture.item.get",
        feature: "fixture",
        target: "fixture.handleItem",
        http: "GET /api/fixture/:itemId/:childId",
        rpc: "fixture.item.get",
        aliases: ["fix get", "fixture read"],
        localInForwardMode: true,
        binary: true,
        requiredScopes: ["fixture:read"],
        readOnly: true,
        destructive: true,
        public: true,
        externalAuth: true,
        deprecated: true,
        replacementService: "external.fixture",
        replacementOperationPrefix: "external.fixture.",
        lifecycle: { status: "deprecated" },
        inputSchema: { type: "object" }
      })
    ]);

    const markdown = formatInterfaceCatalogMarkdown([
      operationFixture({
        feature: "feature\nline",
        label: "Label | Pipe",
        cli: {
          command: ["fixture", "item"],
          aliases: [["fix", "item"]],
          usage: "fixture | item"
        },
        audit: { enabled: false }
      })
    ]);
    expect(markdown).toContain("feature<br>line");
    expect(markdown).toContain("fixture \\| item<br>alias: fix item");
    expect(markdown).toContain("| read_only | yes | yes | disabled |");
  });

  it("resolves CLI entries by longest token match and builds encoded API paths", () => {
    const short = operationFixture({
      id: "fixture.short",
      cli: { command: ["fixture"], usage: "fixture" },
      http: { method: "GET", path: "/api/fixture" }
    });
    const long = operationFixture();
    const matched = findCliOperation(["fixture", "item", "get", "--item-id", "A"], [short, long]);

    expect(getCliEntries(long).map((entry) => entry.tokens)).toEqual([
      ["fixture", "item", "get"],
      ["fix", "get"],
      ["fixture", "read"]
    ]);
    expect(matched.operation.id).toBe("fixture.item.get");
    expect(findCliOperation(["unknown"], [short, long])).toBeNull();

    const path = buildApiPathForCliOperation(long, {
      id: ["ignored", "item/1"],
      "child-id": "child 2",
      tags: [["alpha", "beta"]],
      mode: "read only",
      empty: ""
    });
    expect(path).toBe("/api/fixture/item%2F1/child%202?tag=alpha&tag=beta&mode=read+only");

    expect(buildApiPathForCliOperation(long, {
      "item-id": ["ignored", ""],
      id: "fallback-id",
      "child-id": "child"
    })).toBe("/api/fixture/fallback-id/child");

    expect(() => buildApiPathForCliOperation(long, { id: "item-1" }))
      .toThrow("--child-id is required");
  });

  it("exposes decorated real operations for repo and knowledge distillation compatibility", () => {
    const repoStatus = SERVER_API_OPERATIONS.find((operation) => operation.id === "repo.status");
    expect(repoStatus).toMatchObject({
      feature: "agent_workspace",
      readOnly: true,
      concurrencySafe: true,
      requiredScopes: ["repo:read"],
      safety: expect.objectContaining({ risk: "read_only" })
    });
    expect(repoStatus.inputSchema.required).toEqual(["repoId", "targetType"]);

    const repoMerge = SERVER_API_OPERATIONS.find((operation) => operation.id === "repo.merge");
    expect(repoMerge).toMatchObject({
      readOnly: false,
      concurrencySafe: false,
      safety: expect.objectContaining({
        risk: "repair_write",
        requiresConfirmation: true,
        approvalScope: "repo:maintain"
      })
    });

    const internalDistillation = SERVER_API_OPERATIONS.find((operation) =>
      operation.id.startsWith("knowledge.distillation.") && operation.deprecated === true
    );
    expect(internalDistillation).toMatchObject({
      replacementService: "external.knowledge.distillation",
      replacementOperationPrefix: "external.knowledge.distillation.",
      lifecycle: expect.objectContaining({
        status: "deprecated",
        maintenancePolicy: "compatibility-shim-only"
      })
    });
    expect(internalDistillation.aspects).toEqual(expect.arrayContaining([
      "knowledge-distillation",
      "internal-deprecated",
      "external-replaced"
    ]));
  });
});
