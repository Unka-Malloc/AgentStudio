// Test-only storage wrapper for crash injection.
// Wraps a real storage port and can inject failures at specific call counts.
// Internal use only — NOT part of the public API.

export function createFailingStorage(baseStorage, {
  failOnPutBlock = -1,
  failOnPutProtocolObject = -1,
  failAfterN = -1 // aggregate counter: fail after N total write calls
} = {}) {
  let callCount = 0;

  function shouldFail(specificThreshold) {
    callCount += 1;
    if (specificThreshold >= 0 && callCount > specificThreshold) return true;
    if (failAfterN >= 0 && callCount > failAfterN) return true;
    return false;
  }

  function injectFailure(operation) {
    if (shouldFail(-1)) {
      throw new Error(`CRASH-INJECTED: ${operation} failed at call ${callCount}`);
    }
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
      injectFailure("putBlock");
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
      injectFailure("putProtocolObject");
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
    }
  };
}
