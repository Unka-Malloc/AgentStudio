import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createV001BaselineProvider,
  V001_BASELINE_PROTOCOL_VERSION
} from "../../../server/platform/common/v001/baseline-provider.mjs";

async function withTempUserData(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-v001-baseline-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("v0.0.1 baseline provider extra coverage", () => {
  it("requires a user data path and exposes protocol metadata", () => {
    expect(() => createV001BaselineProvider()).toThrow("userDataPath is required");
    expect(V001_BASELINE_PROTOCOL_VERSION).toBe("pact.v001.baseline.v1");
  });

  it("persists config registry items, normalizes ids, and reports enabled entries", async () => {
    await withTempUserData(async (userDataPath) => {
      const provider = createV001BaselineProvider({ userDataPath });

      await expect(provider.configRegistry.readConfig("unknown")).rejects.toThrow("Unknown v0.0.1 config registry kind");
      await expect(provider.configRegistry.upsert("modules", { label: "missing id" })).rejects.toThrow("Config registry item id is required");

      await provider.configRegistry.writeConfig("modules", {
        entries: [
          { name: "module-a", enabled: true, label: "Module A" },
          { key: "module-b", enabled: false, label: "Module B" },
          { label: "ignored" },
        ],
      });
      await provider.configRegistry.upsert("connectors", {
        id: "connector-a",
        enabled: true,
      });
      await provider.configRegistry.upsert("externalTargets", {
        id: "target-a",
        enabled: false,
      });

      const modules = await provider.configRegistry.readConfig("modules");
      expect(modules.items.map((item) => [item.id, item.enabled])).toEqual([
        ["module-a", true],
        ["module-b", false],
      ]);
      expect(await readText(modules.path)).toContain("\"kind\": \"modules\"");

      const enabled = await provider.configRegistry.listEnabled();
      expect(enabled.modules.map((item) => item.id)).toEqual(["module-a"]);
      expect(enabled.connectors.map((item) => item.id)).toEqual(["connector-a"]);
      expect(enabled.externalTargets).toEqual([]);

      await expect(provider.configRegistry.summary()).resolves.toMatchObject({
        port: "ConfigRegistryPort",
        implementation: "local-json",
        counts: {
          modules: 2,
          connectors: 1,
          externalTargets: 1,
        },
      });
    });
  });

  it("stores metadata records and cache entries with expiry and invalidation", async () => {
    await withTempUserData(async (userDataPath) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
      const provider = createV001BaselineProvider({ userDataPath });

      const generated = await provider.metadataStore.put({
        kind: "workspace",
        dataClass: "pending_classification",
      });
      expect(generated.id).toMatch(/^meta_[a-f0-9]{21}$/);
      expect(await provider.metadataStore.get(generated.id)).toMatchObject({
        id: generated.id,
        kind: "workspace",
        dataClass: "pending_classification",
      });

      const explicit = await provider.metadataStore.put({ id: "workspace:alpha", kind: "workspace" });
      expect((await provider.metadataStore.list()).map((item) => item.id).sort()).toEqual([
        generated.id,
        explicit.id,
      ].sort());
      await expect(provider.metadataStore.summary()).resolves.toMatchObject({
        port: "MetadataStorePort",
        recordCount: 2,
      });

      await expect(provider.cache.set({ scope: "unit" })).rejects.toThrow("Cache key is required");
      const cached = await provider.cache.set({
        scope: "unit",
        key: "capabilities",
        value: { outlets: ["pact.discovery"] },
        ttlMs: 1000,
      });
      expect(cached).toMatchObject({
        cacheKey: "unit:capabilities",
        status: "cached",
      });
      await expect(provider.cache.get({ scope: "unit", key: "capabilities" })).resolves.toMatchObject({
        hit: true,
        cacheKey: "unit:capabilities",
        status: "cached",
        value: { outlets: ["pact.discovery"] },
      });

      vi.setSystemTime(new Date("2026-06-04T00:00:02.000Z"));
      await expect(provider.cache.get({ scope: "unit", key: "capabilities" })).resolves.toMatchObject({
        hit: false,
        status: "expired",
        cacheKey: "unit:capabilities",
      });
      await expect(provider.cache.invalidate({ scope: "unit", key: "capabilities" })).resolves.toEqual({
        cacheKey: "unit:capabilities",
        invalidated: true,
      });
      await expect(provider.cache.invalidate({ scope: "unit", key: "missing" })).resolves.toEqual({
        cacheKey: "unit:missing",
        invalidated: false,
      });
    });
  });

  it("dedupes queue tasks and advances claimed tasks through heartbeat and completion", async () => {
    await withTempUserData(async (userDataPath) => {
      const provider = createV001BaselineProvider({ userDataPath });

      const queued = await provider.queue.enqueue({
        queueName: "baseline",
        idempotencyKey: "same-work",
        payload: { operation: "v001.baseline.status" },
      });
      const deduped = await provider.queue.enqueue({
        queueName: "baseline",
        idempotencyKey: "same-work",
        payload: { operation: "ignored" },
      });
      expect(deduped).toMatchObject({
        taskId: queued.taskId,
        deduped: true,
        payload: { operation: "v001.baseline.status" },
      });

      const claimed = await provider.queue.claim({ queueName: "baseline", workerId: "worker-a" });
      expect(claimed).toMatchObject({
        taskId: queued.taskId,
        status: "claimed",
        workerId: "worker-a",
        attempts: 1,
      });
      await expect(provider.queue.claim({ queueName: "baseline" })).resolves.toBeNull();
      await expect(provider.queue.heartbeat({ taskId: "missing" })).resolves.toBeNull();

      const heartbeat = await provider.queue.heartbeat({ taskId: claimed.taskId, workerId: "worker-b" });
      expect(heartbeat).toMatchObject({
        taskId: claimed.taskId,
        workerId: "worker-a",
      });

      const completed = await provider.queue.complete({ taskId: claimed.taskId, result: { ok: true } });
      expect(completed).toMatchObject({
        status: "completed",
        result: { ok: true },
      });
      await expect(provider.queue.complete({ taskId: "missing" })).resolves.toBeNull();
      await expect(provider.queue.summary()).resolves.toMatchObject({
        port: "QueuePort",
        taskCount: 1,
        queuedCount: 0,
      });
    });
  });

  it("stores content-addressed artifacts and rejects missing content", async () => {
    await withTempUserData(async (userDataPath) => {
      const provider = createV001BaselineProvider({ userDataPath });

      await expect(provider.artifactStore.putArtifact()).rejects.toThrow("Artifact bytes, text, or json is required");
      const textArtifact = await provider.artifactStore.putArtifact({
        text: "baseline artifact\n",
        contentType: "text/plain",
        metadata: { operation: "v001.baseline.status" },
      });
      const jsonArtifact = await provider.artifactStore.putArtifact({
        json: { b: 2, a: 1 },
      });

      expect(textArtifact).toMatchObject({
        status: "archived",
        contentType: "text/plain",
        metadata: { operation: "v001.baseline.status" },
      });
      await expect(provider.artifactStore.getArtifact(textArtifact.artifactRef)).resolves.toMatchObject({
        artifactRef: textArtifact.artifactRef,
        bytes: Buffer.from("baseline artifact\n"),
      });
      await expect(provider.artifactStore.getArtifact("artifact:missing")).resolves.toBeNull();
      expect((await provider.artifactStore.getArtifact(jsonArtifact.artifactRef)).bytes.toString("utf8")).toBe("{\"a\":1,\"b\":2}");
      await expect(provider.artifactStore.summary()).resolves.toMatchObject({
        port: "ArtifactStorePort",
        artifactCount: 2,
      });
    });
  });

  it("creates non-revealing secret refs and summarizes provider readiness", async () => {
    await withTempUserData(async (userDataPath) => {
      const provider = createV001BaselineProvider({ userDataPath });
      const secret = await provider.secretStore.createSecretRef({
        namespace: "unit",
        name: "api-token",
        provider: "contract-mode",
        secretValue: "very-secret-value",
        metadata: { purpose: "test" },
      });

      expect(secret).toMatchObject({
        namespace: "unit",
        name: "api-token",
        provider: "contract-mode",
        verificationMode: "contractVerified",
        redacted: "***ue",
      });
      expect(await readText(provider.secretStore.registryPath)).not.toContain("very-secret-value");
      await expect(provider.secretStore.resolveSecretRef(secret.secretRef)).resolves.toMatchObject({
        secretRef: secret.secretRef,
        handleType: "controlled-secret-handle",
        canRevealValue: false,
      });
      await expect(provider.secretStore.resolveSecretRef("secretref:missing")).resolves.toBeNull();
      await expect(provider.secretStore.summary()).resolves.toMatchObject({
        port: "SecretStorePort",
        verificationMode: "contractVerified",
        secretRefCount: 1,
      });

      const status = await provider.status();
      expect(status).toMatchObject({
        protocolVersion: V001_BASELINE_PROTOCOL_VERSION,
        status: "ready",
        verificationMode: "verified",
        boundaries: {
          runtimeConfig: "ServerConfig.getDataDir()/v001-baseline",
        },
      });
      expect(status.mcpOutlets).toEqual(["pact.discovery", "pact.knowledge", "pact.sharedspace", "pact.codespace", "pact.skillHub"]);
      expect(status.storageStates).toContain("contractVerified");
      expect(status.ports.map((port) => port.port)).toEqual([
        "ConfigRegistryPort",
        "MetadataStorePort",
        "CachePort",
        "QueuePort",
        "ArtifactStorePort",
        "SecretStorePort",
      ]);
    });
  });
});
