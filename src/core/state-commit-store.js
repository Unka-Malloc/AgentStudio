import { randomUUID } from "node:crypto";
import {
  PACTIUM_PROTOCOL,
  PACTIUM_SCHEMA_VERSION
} from "../protocol/constants.js";
import { protocolHash } from "../protocol/hashing.js";
import { canonicalString, normalizeCanonicalValue } from "../canonical/value.js";
import { createAppendOnlyEventLog } from "./append-only-event-log.js";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function storageKey(...parts) {
  return parts.map((part) => text(part, "_")).join(":");
}

function substrateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizePathKey(value) {
  return text(value).replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Host-neutral state root commit helper.
 * Persists roots, commit records, and append-only events; binds optional
 * Operation Ledger evidence through the provided Pactium core.
 */
export function createStateCommitStore({
  storage = null,
  core = null,
  indexEngine = null,
  eventLog = null,
  scopes = {},
  hashDomainPrefix = "pactium.state",
  eventHashDomain = "pactium.state-event",
  createCommitId = null,
  createEventId = null,
  defaultCommitOperationId = "pactium.state.commit",
  defaultRestoreOperationId = "pactium.state.root.restore",
  withTransaction = null
} = {}) {
  if (!storage || typeof storage.getProtocolObject !== "function") {
    throw new TypeError("createStateCommitStore requires a Pactium storage port.");
  }
  if (!core || typeof core.recordOperation !== "function") {
    throw new TypeError("createStateCommitStore requires a Pactium core.");
  }
  if (!indexEngine || typeof indexEngine.createIndex !== "function") {
    throw new TypeError("createStateCommitStore requires a verifiable index engine.");
  }

  const resolvedScopes = {
    stateRoot: text(scopes.stateRoot, "pactium-state-root"),
    stateCommit: text(scopes.stateCommit, "pactium-state-commit"),
    stateCommitEventIndex: text(scopes.stateCommitEventIndex, "pactium-state-commit-event-index"),
    stateMutationIdempotency: text(scopes.stateMutationIdempotency, "pactium-state-mutation-idempotency")
  };

  const resolvedEventLog = eventLog || createAppendOnlyEventLog({
    storage,
    protocolObjectScope: text(scopes.eventLog, "pactium-event-log"),
    hashDomain: eventHashDomain,
    createEventId
  });

  const resolveCommitId = typeof createCommitId === "function"
    ? createCommitId
    : ({ scope, eventHash }) => storageKey("state-commit", scope, eventHash, nowIso(), randomUUID());

  async function runTransaction(capability, task) {
    if (typeof withTransaction === "function") {
      return withTransaction(task, { capability });
    }
    if (typeof core.withMutationTransaction === "function") {
      return core.withMutationTransaction(task);
    }
    return task();
  }

  async function loadStateRoot(scope) {
    if (!storage.inMemory) storage.clearCache?.();
    return text(await storage.getProtocolObject(resolvedScopes.stateRoot, storageKey("state-root", scope), ""));
  }

  async function saveStateRoot(scope, root) {
    await storage.putProtocolObject(resolvedScopes.stateRoot, storageKey("state-root", scope), text(root));
  }

  async function loadCommit(commitId) {
    if (!storage.inMemory) storage.clearCache?.();
    return storage.getProtocolObject(resolvedScopes.stateCommit, text(commitId), null);
  }

  async function saveCommit(commit) {
    await storage.putProtocolObject(resolvedScopes.stateCommit, commit.commitId, commit);
    await storage.putProtocolObject(
      resolvedScopes.stateCommitEventIndex,
      storageKey(
        "state-commit-event",
        canonicalString({
          scope: commit.scope,
          eventHash: commit.eventHash
        })
      ),
      {
        commitId: commit.commitId,
        scope: commit.scope,
        eventHash: commit.eventHash
      }
    );
  }

  function stateMutationIdempotencyKey({ kind, scope, operationId, idempotencyKey }) {
    return storageKey("state-mutation-idempotency", canonicalString({
      kind: text(kind),
      scope: text(scope, "default"),
      operationId: text(operationId),
      idempotencyKey: text(idempotencyKey)
    }));
  }

  function stateMutationInputDigest(kind, input = {}) {
    return protocolHash(`${hashDomainPrefix}-${kind}`, normalizeCanonicalValue({
      scope: text(input.scope, "default"),
      operationId: text(input.operationId),
      ...(Object.hasOwn(input, "expectedCurrentRoot")
        ? { expectedCurrentRoot: text(input.expectedCurrentRoot) }
        : {}),
      ...(kind === "restore"
        ? {
            targetRoot: text(input.targetRoot || input.root),
            anchor: asObject(input.anchor),
            allowedOperationIds: asArray(input.allowedOperationIds).map(text).filter(Boolean),
            maxSuffixEvents: Number(input.maxSuffixEvents || 256)
          }
        : {
            mutations: asArray(input.mutations),
            contentRefs: asArray(input.contentRefs)
          }),
      payload: asObject(input.payload)
    }));
  }

  async function replayStateMutationIfPresent(kind, input = {}) {
    const idempotencyKey = text(input.idempotencyKey);
    if (!idempotencyKey) return null;
    const scope = text(input.scope, "default");
    const operationId = text(
      input.operationId,
      kind === "restore" ? defaultRestoreOperationId : defaultCommitOperationId
    );
    const claimKey = stateMutationIdempotencyKey({
      kind,
      scope,
      operationId,
      idempotencyKey
    });
    const inputDigest = stateMutationInputDigest(kind, {
      ...input,
      operationId
    });
    const existing = await storage.getProtocolObject(
      resolvedScopes.stateMutationIdempotency,
      claimKey,
      null
    );
    if (!existing) {
      return { claimKey, inputDigest, replay: null };
    }
    if (text(existing.inputDigest) !== inputDigest) {
      throw substrateError(
        "state_mutation_idempotency_conflict",
        "State mutation idempotency key was reused with different input."
      );
    }
    const commit = await loadCommit(text(existing.commitId));
    if (!commit || commit.scope !== scope || commit.operationId !== operationId) {
      throw substrateError(
        "state_mutation_idempotency_incomplete",
        "State mutation idempotency claim is incomplete."
      );
    }
    return {
      claimKey,
      inputDigest,
      replay: Object.freeze({ ...commit, replayed: true })
    };
  }

  async function saveStateMutationClaim({ claimKey, inputDigest, commit }) {
    if (!claimKey) return;
    await storage.putProtocolObject(
      resolvedScopes.stateMutationIdempotency,
      claimKey,
      {
        inputDigest,
        commitId: commit.commitId,
        scope: commit.scope,
        operationId: commit.operationId
      }
    );
  }

  async function putIndex(root, key, valueRef, metadata = {}) {
    const normalizedKey = normalizePathKey(key);
    const next = await indexEngine.put(root, normalizedKey, {
      key: normalizedKey,
      valueRef: text(valueRef),
      valueHash: protocolHash("block", { valueRef: text(valueRef) }),
      metadata: normalizeCanonicalValue(asObject(metadata))
    });
    return next.root;
  }

  async function deleteIndex(root, key) {
    const next = await indexEngine.delete(root, normalizePathKey(key));
    return next.root;
  }

  async function verifyRestoreLineage({
    scope,
    targetRoot,
    allowedOperationIds = [],
    anchor = null,
    maxSuffixEvents = 256
  }) {
    const events = await resolvedEventLog.listEvents(scope, { limit: 10000 });
    const chronological = [...events].reverse();
    const anchorOffset = Number(anchor?.offset);
    const anchoredEvent = Number.isInteger(anchorOffset) ? chronological[anchorOffset] : null;
    const anchorIndex = anchoredEvent?.eventHash === text(anchor?.eventHash) &&
      anchoredEvent?.afterRoot === targetRoot
      ? anchorOffset
      : -1;
    const allowed = asArray(allowedOperationIds).map(text).filter(Boolean);
    const suffix = chronological.slice(anchorIndex + 1);
    const conflicting = suffix.find((event) => !allowed.includes(text(event.operationId)));
    if (anchorIndex < 0 || allowed.length === 0 || suffix.length > Math.max(1, Number(maxSuffixEvents) || 256) || conflicting) {
      const error = substrateError(
        "state_root_restore_lineage_conflict",
        "State root restore lineage contains an unrelated mutation."
      );
      error.status = 409;
      throw error;
    }
    return { ok: true, eventCount: suffix.length };
  }

  return Object.freeze({
    scopes: Object.freeze({ ...resolvedScopes }),
    eventLog: resolvedEventLog,
    async begin({ scope = "default" } = {}) {
      return {
        scope: text(scope, "default"),
        currentRoot: await loadStateRoot(scope)
      };
    },
    async commit(input = {}) {
      return runTransaction("State commits", async () => {
        const scope = text(input.scope, "default");
        const idempotency = await replayStateMutationIfPresent("commit", { ...input, scope });
        if (idempotency?.replay) return idempotency.replay;
        const beforeRoot = await loadStateRoot(scope);
        if (Object.hasOwn(input, "expectedCurrentRoot") && text(input.expectedCurrentRoot) !== beforeRoot) {
          const error = substrateError("state_root_commit_conflict", "State root changed before commit.");
          error.status = 409;
          throw error;
        }
        let afterRoot = beforeRoot;
        if (!afterRoot) {
          afterRoot = (await indexEngine.createIndex([], { domain: `state:${scope}` })).root;
        }
        const mutations = asArray(input.mutations);
        for (const mutation of mutations) {
          const action = text(mutation.action, "put");
          if (action === "delete") {
            afterRoot = await deleteIndex(afterRoot, mutation.key);
          } else {
            afterRoot = await putIndex(
              afterRoot,
              mutation.key,
              mutation.valueRef || mutation.value,
              mutation.metadata || {}
            );
          }
        }
        const operationId = text(input.operationId, defaultCommitOperationId);
        const envelope = await core.recordOperation({
          operationId,
          workspaceId: scope,
          idempotencyKey: text(input.idempotencyKey),
          returnIntentReplay: true,
          input: asObject(input.payload),
          result: { beforeRoot, afterRoot },
          stateMutations: mutations.map((mutation) => ({
            action: text(mutation.action, "put"),
            key: normalizePathKey(mutation.key),
            valueRef: text(mutation.valueRef || mutation.value),
            valueHash: text(mutation.valueHash || protocolHash("block", {
              valueRef: text(mutation.valueRef || mutation.value || "")
            })),
            metadata: asObject(mutation.metadata)
          })).filter((mutation) => mutation.key)
        });
        if (envelope?.replayed) {
          throw substrateError(
            "state_mutation_idempotency_incomplete",
            "State evidence replay exists without a matching state mutation claim."
          );
        }
        await saveStateRoot(scope, afterRoot);
        const event = await resolvedEventLog.appendEvent({
          partitionId: scope,
          operationId,
          beforeRoot,
          afterRoot,
          contentRefs: input.contentRefs || [],
          payload: input.payload || {}
        });
        const commit = {
          protocol: PACTIUM_PROTOCOL,
          schema: PACTIUM_SCHEMA_VERSION,
          commitId: resolveCommitId({ scope, eventHash: event.eventHash }),
          scope,
          operationId,
          beforeRoot,
          afterRoot,
          eventHash: event.eventHash,
          eventId: event.eventId,
          contentRefs: asArray(input.contentRefs).map(text).filter(Boolean),
          mutations: normalizeCanonicalValue(mutations),
          payload: normalizeCanonicalValue(asObject(input.payload)),
          evidence: {
            envelopeId: envelope.envelopeId,
            outcomeId: envelope.factId,
            ledgerEventId: envelope.factRef?.ledgerEventId || "",
            ledgerIndex: envelope.factRef?.ledgerIndex ?? -1
          },
          createdAt: nowIso()
        };
        await saveCommit(commit);
        await saveStateMutationClaim({
          claimKey: idempotency?.claimKey,
          inputDigest: idempotency?.inputDigest,
          commit
        });
        return commit;
      });
    },
    async verifyRestoreLineage(input = {}) {
      const scope = text(input.scope, "default");
      const targetRoot = text(input.targetRoot || input.root);
      return verifyRestoreLineage({
        scope,
        targetRoot,
        allowedOperationIds: input.allowedOperationIds,
        anchor: input.anchor,
        maxSuffixEvents: input.maxSuffixEvents
      });
    },
    async restoreRoot(input = {}) {
      return runTransaction("State root restores", async () => {
        const scope = text(input.scope, "default");
        const idempotency = await replayStateMutationIfPresent("restore", { ...input, scope });
        if (idempotency?.replay) return idempotency.replay;
        const targetRoot = text(input.targetRoot || input.root);
        const beforeRoot = await loadStateRoot(scope);
        if (!targetRoot) throw new Error("State root restore requires a target root.");
        if (Object.hasOwn(input, "expectedCurrentRoot") && text(input.expectedCurrentRoot) !== beforeRoot) {
          throw substrateError("state_root_restore_conflict", "State root changed before restore.");
        }
        await verifyRestoreLineage({
          scope,
          targetRoot,
          allowedOperationIds: input.allowedOperationIds,
          anchor: input.anchor,
          maxSuffixEvents: input.maxSuffixEvents
        });
        const operationId = text(input.operationId, defaultRestoreOperationId);
        const envelope = await core.recordOperation({
          operationId,
          workspaceId: scope,
          idempotencyKey: text(input.idempotencyKey),
          returnIntentReplay: true,
          input: asObject(input.payload),
          result: { beforeRoot, afterRoot: targetRoot },
          stateMutations: []
        });
        if (envelope?.replayed) {
          throw substrateError(
            "state_mutation_idempotency_incomplete",
            "State evidence replay exists without a matching state mutation claim."
          );
        }
        await saveStateRoot(scope, targetRoot);
        const event = await resolvedEventLog.appendEvent({
          partitionId: scope,
          operationId,
          beforeRoot,
          afterRoot: targetRoot,
          contentRefs: input.contentRefs || [],
          payload: { ...asObject(input.payload), restoredRoot: targetRoot }
        });
        const commit = {
          protocol: PACTIUM_PROTOCOL,
          schema: PACTIUM_SCHEMA_VERSION,
          commitId: resolveCommitId({ scope, eventHash: event.eventHash }),
          scope,
          operationId,
          beforeRoot,
          afterRoot: targetRoot,
          eventHash: event.eventHash,
          eventId: event.eventId,
          contentRefs: asArray(input.contentRefs).map(text).filter(Boolean),
          mutations: [],
          payload: normalizeCanonicalValue(asObject(input.payload)),
          evidence: {
            envelopeId: envelope.envelopeId,
            outcomeId: envelope.factId,
            ledgerEventId: envelope.factRef?.ledgerEventId || "",
            ledgerIndex: envelope.factRef?.ledgerIndex ?? -1
          },
          createdAt: nowIso()
        };
        await saveCommit(commit);
        await saveStateMutationClaim({
          claimKey: idempotency?.claimKey,
          inputDigest: idempotency?.inputDigest,
          commit
        });
        return commit;
      });
    },
    async verifyCommit(commitId) {
      const commit = await loadCommit(text(commitId));
      if (!commit) {
        return {
          ok: false,
          error: "commit_missing",
          commitId: text(commitId)
        };
      }
      try {
        await indexEngine.readIndexRoot(commit.afterRoot);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "state_root_missing",
          commit
        };
      }
      return { ok: true, commit };
    },
    async getCommitByEventHash({ scope = "default", eventHash = "" } = {}) {
      const normalizedScope = text(scope, "default");
      const normalizedEventHash = text(eventHash);
      if (!normalizedEventHash) return null;
      const indexed = await storage.getProtocolObject(
        resolvedScopes.stateCommitEventIndex,
        storageKey(
          "state-commit-event",
          canonicalString({
            scope: normalizedScope,
            eventHash: normalizedEventHash
          })
        ),
        null
      );
      if (!indexed?.commitId) return null;
      return loadCommit(indexed.commitId);
    }
  });
}
