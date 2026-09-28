/**
 * lib/mem-cache.js — the per-instance 5-minute cache behind getCached /
 * setCached (moved out of lib/sheets.js on 28/09 so /api/data, which only
 * needs the cache, no longer loads googleapis — ~1s — on a cold start).
 * lib/sheets.js re-exports these; both share this one Map.
 */
const cache = new Map();
export const CACHE_TTL_MS = 5 * 60 * 1000;

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached(key, data, ttl = CACHE_TTL_MS) {
  cache.set(key, { ts: Date.now(), data, ttl });
}

export function invalidateCache(key) {
  cache.delete(key);
}

export function clearAllCache() {
  cache.clear();
}
