// Test-only storage wrapper for crash injection.
// Wraps a real storage port and can inject failures at specific call counts
// or based on predicates. Internal use only — NOT part of the public API.

export function createFailingStorage(baseStorage, {
  failOnPutBlock = -1,
  failOnPutProtocolObject = -1,
  failAfterN = -1, // aggregate counter: fail after N total write calls
  failOnPutBlockPredicate = null, // (value, options) => true to fail
  failOnPutProtocolObjectPredicate = null // (scope, key, value) => true to fail
} = {}) {
  let callCount = 0;
  const callLog = [];

  function recordCall(method, details = {}) {
    callCount += 1;
    callLog.push({ call: callCount, method, ...details });
  }

  function shouldFail(method, specificThreshold) {
    if (specificThreshold >= 0 && callCount >= specificThreshold) return true;
    if (failAfterN >= 0 && callCount >= failAfterN) return true;
    return false;
  }

  return {
    protocol: baseStorage.protocol,
    schema: baseStorage.schema,
    dataDir: baseStorage.dataDir,
    inMemory: baseStorage.inMemory,
    initialize: baseStorage.initialize,
    clearCache: baseStorage.clearCache?.bind(baseStorage),
    withWriteLock: baseStorage.withWriteLock?.bind(baseStorage),
    pruneBlocks: baseStorage.pruneBlocks?.bind(baseStorage),
    pruneProtocolObjects: baseStorage.pruneProtocolObjects?.bind(baseStorage),

    async putBlock(value, options) {
      recordCall("putBlock", { kind: options?.kind });
      if (failOnPutBlockPredicate && failOnPutBlockPredicate(value, options)) {
        throw new Error(`CRASH-INJECTED: putBlock failed by predicate at call ${callCount}`);
      }
      if (shouldFail("putBlock", failOnPutBlock)) {
        throw new Error(`CRASH-INJECTED: putBlock failed at call ${callCount}`);
      }
      return baseStorage.putBlock(value, options);
    },
    async getBlock(cid) {
      return baseStorage.getBlock(cid);
    },
    async hasBlock(cid) {
      return baseStorage.hasBlock(cid);
    },
    async walk(rootCid) {
      return baseStorage.walk(rootCid);
    },
    async putProtocolObject(scope, key, value) {
      recordCall("putProtocolObject", { scope, key });
      if (failOnPutProtocolObjectPredicate && failOnPutProtocolObjectPredicate(scope, key, value)) {
        throw new Error(`CRASH-INJECTED: putProtocolObject failed by predicate at call ${callCount}`);
      }
      if (shouldFail("putProtocolObject", failOnPutProtocolObject)) {
        throw new Error(`CRASH-INJECTED: putProtocolObject failed at call ${callCount}`);
      }
      return baseStorage.putProtocolObject(scope, key, value);
    },
    async getProtocolObject(scope, key, fallback) {
      return baseStorage.getProtocolObject(scope, key, fallback);
    },
    async deleteProtocolObject(scope, key) {
      return baseStorage.deleteProtocolObject(scope, key);
    },
    async listProtocolObjectKeys(scope) {
      return baseStorage.listProtocolObjectKeys(scope);
    },

    // Inspection helpers for tests
    getCallLog() { return [...callLog]; },
    getCallCount() { return callCount; },
    resetCounters() { callCount = 0; callLog.length = 0; }
  };
}
