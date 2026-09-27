/**
 * lib/report-cache.js — in-memory cache of computed company reports (27/09).
 * A report is a pure function of (snapshot, channel config, type, period,
 * clients, time); the tab asks for the same one repeatedly (selection clicks,
 * lock diff), so repeat requests on a warm instance skip the ~0.2–1s compute.
 * Keyed on the snapshot's builtAt + the config version, so new data or a
 * saved config never serves a stale report; the 5-minute time bucket keeps
 * "chưa chín" / "đang diễn ra" flags current.
 */
const MAX_ENTRIES = 40;
const BUCKET_MS = 5 * 60 * 1000;
const cache = new Map();

export function reportCacheKey({ builtAt, version, type, period, clients, now = Date.now() }) {
  return [builtAt || "", version || "", type, period, (clients || []).join("|"), Math.floor(now / BUCKET_MS)].join("§");
}

export function getCachedReport(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key); // refresh recency
  cache.set(key, hit);
  return hit;
}

export function setCachedReport(key, report) {
  cache.set(key, report);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

export function clearReportCache() {
  cache.clear();
}
