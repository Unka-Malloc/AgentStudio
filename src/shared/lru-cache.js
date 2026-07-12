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
