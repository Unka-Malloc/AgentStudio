import { describe, expect, it } from "vitest";
import {
  buildClientRuntimeBootstrapPlan,
  buildClientRuntimeBootstrapPull,
  planClientRuntimeTransports,
} from "../../../server/services/client/client-runtime-core/client-runtime-bootstrap.mjs";
import {
  CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
  normalizeClientRuntimeConfig,
} from "../../../server/services/client/client-runtime-core/client-runtime-allocator.mjs";

describe("client runtime bootstrap planning", () => {
  it("prefers native rsync when client commands and server capabilities allow it", () => {
    const plan = planClientRuntimeTransports({
      client: { commands: ["ssh", "rsync", "scp"] },
      serverCapabilities: { ssh: true, rsync: true, scp: true },
      transfer: { totalBytes: 4096, fileCount: 1 },
    });

    expect(plan.selected).toBe("rsync-over-ssh");
    expect(plan.fallbackOrder).toContain("pact-http-upload-session");
    expect(plan.candidates.find((item) => item.id === "scp")?.available).toBe(true);
  });

  it("builds a trimmed module plan and inline pull manifest", () => {
    const plan = buildClientRuntimeBootstrapPlan({
      clientUid: "desktop-a",
      client: { commands: ["ssh"], modules: ["knowledge-cache"] },
      capabilities: ["upload.session"],
      serverCapabilities: { ssh: true },
      transfer: { totalBytes: 512, fileCount: 1 },
    });

    expect(plan.client.clientUid).toBe("desktop-a");
    expect(plan.modules.map((item) => item.moduleId)).toEqual(
      expect.arrayContaining(["runtime-framework", "pact-client-cli", "checkpoint-http-upload", "knowledge-cache"]),
    );

    const pull = buildClientRuntimeBootstrapPull({ clientUid: "desktop-a", modules: ["knowledge-cache"] });
    expect(pull.operation).toBe("client_runtime.bootstrap.pull");
    expect(pull.bundle.digestSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("client runtime allocation config", () => {
  it("normalizes profiles, task filters, and cooling policy", () => {
    const config = normalizeClientRuntimeConfig({
      version: 3,
      defaultProfile: {
        profileId: "default",
        modelAlias: "qwen",
        contextProfileId: "large",
      },
      coolingPolicy: {
        bucketMs: 1,
        maxWarmClients: -2,
      },
      profiles: [
        { profileId: "low", priority: 1, taskTypes: ["summarize"] },
        { profileId: "high", priority: 5, clientKey: "desktop-a", taskTypes: ["code"] },
      ],
    });

    expect(config.protocolVersion).toBe(CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION);
    expect(config.version).toBe(3);
    expect(config.profiles.map((profile) => profile.profileId)).toEqual(["high", "low"]);
    expect(config.profiles[0].clientKeys).toEqual(["desktop-a"]);
    expect(config.coolingPolicy.bucketMs).toBe(10_000);
    expect(config.coolingPolicy.maxWarmClients).toBe(0);
  });
});
