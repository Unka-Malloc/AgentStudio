import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendJsonLineSerialized,
  atomicWriteFile,
  createStateMutationDispatcher,
  queueStateMutation,
  readJsonFile,
  setBoundedMapEntry,
  stateFileKey,
  waitForStateIdle
} from "../../../server/platform/common/platform-core/state-coordinator.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("state coordinator final extra coverage", () => {
  it("rejects invalid mutation tasks and logs dispatcher failures", async () => {
    expect(() => queueStateMutation("invalid", null)).toThrow(
      "queueStateMutation requires a task function."
    );

    const logger = {
      debug: vi.fn(),
      error: vi.fn()
    };
    const dispatcher = createStateMutationDispatcher({ logger });

    await expect(dispatcher.mutate({
      key: "bad-dispatch",
      task: null
    })).rejects.toThrow("StateMutationDispatcher.mutate requires a task function.");

    await expect(dispatcher.mutate({
      key: "throwing-dispatch",
      kind: "state.test.throw",
      metadata: { source: "unit" },
      task: async () => {
        throw new Error("planned mutation failure");
      }
    })).rejects.toThrow("planned mutation failure");

    expect(logger.error).toHaveBeenCalledWith(
      "state.dispatch.failed",
      expect.objectContaining({
        mutationKind: "state.test.throw"
      })
    );
    await waitForStateIdle("throwing-dispatch");
  });

  it("serializes dispatcher file writes, append helpers, and idle waits", async () => {
    const root = await tempDir("pact-state-coordinator-");
    const jsonPath = path.join(root, "nested", "state.json");
    const jsonlPath = path.join(root, "events", "events.jsonl");
    const dispatcher = createStateMutationDispatcher();

    await dispatcher.writeJson(jsonPath, { ok: true }, {
      trailingNewline: false,
      kind: "state.test.write",
      metadata: { file: "state" }
    });
    await dispatcher.appendJsonLine(jsonlPath, { event: 1 }, {
      kind: "state.test.append",
      metadata: { file: "events" }
    });
    await appendJsonLineSerialized(jsonlPath, { event: 2 });
    await waitForStateIdle(stateFileKey(jsonlPath));

    expect(await fs.readFile(jsonPath, "utf8")).toBe(JSON.stringify({ ok: true }, null, 2));
    expect((await fs.readFile(jsonlPath, "utf8")).trim().split("\n")).toEqual([
      JSON.stringify({ event: 1 }),
      JSON.stringify({ event: 2 })
    ]);
  });

  it("cleans temporary atomic writes and handles JSON fallback/error branches", async () => {
    const root = await tempDir("pact-state-coordinator-files-");
    const directoryTarget = path.join(root, "directory-target");
    await fs.mkdir(directoryTarget);

    await expect(atomicWriteFile(directoryTarget, "content")).rejects.toThrow();
    const leftovers = await fs.readdir(root);
    expect(leftovers.filter((name) => name.startsWith(".directory-target."))).toEqual([]);

    const emptyPath = path.join(root, "empty.json");
    await fs.writeFile(emptyPath, "   \n");
    await expect(readJsonFile(emptyPath, { fallback: true })).resolves.toEqual({ fallback: true });

    const invalidPath = path.join(root, "invalid.json");
    await fs.writeFile(invalidPath, "{not-json");
    await expect(readJsonFile(invalidPath, {})).rejects.toThrow();
  });

  it("keeps bounded maps ordered while tolerating invalid map inputs", () => {
    expect(setBoundedMapEntry(null, "x", 1, 1)).toBeUndefined();

    const map = new Map([
      ["first", 1],
      ["second", 2]
    ]);
    setBoundedMapEntry(map, "first", 3, 2);
    expect([...map.entries()]).toEqual([
      ["second", 2],
      ["first", 3]
    ]);

    setBoundedMapEntry(map, "third", 4, 2);
    expect([...map.entries()]).toEqual([
      ["first", 3],
      ["third", 4]
    ]);
  });
});
