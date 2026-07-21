// Bounded LRU helpers shared by proof-side caches (ledger range roots and
// event index, index-engine nodes/roots/snapshots/boundary signals). Map
// iteration order is insertion order, so re-inserting on read keeps the
// least-recently-used entry first for O(1) eviction.

export function cacheGet(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function cacheSet(cache, key, value, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    cache.delete(cache.keys().next().value);
  }
}

export function createWeightedLruCache({
  maxEntries = 256,
  maxWeight = Number.MAX_SAFE_INTEGER,
  weightOf = () => 1
} = {}) {
  const configuredEntries = Number(maxEntries);
  const configuredWeight = Number(maxWeight);
  const entryLimit = Number.isSafeInteger(configuredEntries) && configuredEntries > 0
    ? configuredEntries
    : 256;
  const weightLimit = Number.isFinite(configuredWeight) && configuredWeight > 0
    ? configuredWeight
    : Number.MAX_SAFE_INTEGER;
  const entries = new Map();
  const weights = new Map();
  let totalWeight = 0;

  function remove(key) {
    if (!entries.has(key)) return false;
    entries.delete(key);
    totalWeight -= Number(weights.get(key) || 0);
    weights.delete(key);
    return true;
  }

  return Object.freeze({
    get size() { return entries.size; },
    get weight() { return totalWeight; },
    has(key) { return entries.has(key); },
    get(key) { return cacheGet(entries, key); },
    set(key, value, explicitWeight) {
      const measured = explicitWeight === undefined ? weightOf(value, key) : explicitWeight;
      const numericWeight = Number(measured);
      const weight = Number.isFinite(numericWeight) && numericWeight > 0 ? numericWeight : 0;
      remove(key);
      if (weight > weightLimit) return value;
      entries.set(key, value);
      weights.set(key, weight);
      totalWeight += weight;
      while (entries.size > entryLimit || totalWeight > weightLimit) {
        remove(entries.keys().next().value);
      }
      return value;
    },
    delete: remove,
    clear() {
      entries.clear();
      weights.clear();
      totalWeight = 0;
    },
    keys() { return entries.keys(); }
  });
}
