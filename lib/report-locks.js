/**
 * lib/report-locks.js — "Chốt số" for the company report (2026-09-27).
 * The live report always reflects the latest data, so numbers for recent
 * weeks keep moving after they were sent. Locking stores the computed report
 * as-is in the private Blob store, so the exact file sent to the company can
 * be re-downloaded later. One lock per report type + period (re-locking
 * overwrites, recorded in the audit log by the caller).
 */
import { put, get, list } from "@vercel/blob";

const PREFIX = "reports/";
const pathOf = (type, period) => `${PREFIX}${type}/${period}.json`;

// Blob list() takes ~1s every call (measured 28/09), and the tab asks for the
// list each time it opens. Cached per instance; saveLock updates this
// instance's copy in place, and the tab re-reads with fresh=1 right after
// locking. Another warm instance can lag by at most LIST_TTL_MS (locks are
// rare: a few per month). The keep-warm ping refreshes it (lib/warm.js).
const LIST_TTL_MS = 5 * 60 * 1000;
let listCache = null; // { at, locks }

export async function saveLock(type, period, report, lockedBy) {
  const lock = { type, period, lockedAt: new Date().toISOString(), lockedBy: lockedBy || "", report };
  const blob = await put(pathOf(type, period), JSON.stringify(lock), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
  });
  if (listCache) {
    // Same shape as listLocks(): lockedAt = blob upload time.
    const at = blob?.uploadedAt ? new Date(blob.uploadedAt).toISOString() : lock.lockedAt;
    const locks = listCache.locks.filter((l) => !(l.type === type && l.period === period));
    locks.push({ type, period, lockedAt: at });
    listCache = { at: listCache.at, locks: locks.sort((a, b) => b.lockedAt.localeCompare(a.lockedAt)) };
  }
  return { type, period, lockedAt: lock.lockedAt, lockedBy: lock.lockedBy, clients: report.selection || null };
}

export async function readLock(type, period) {
  try {
    const res = await get(pathOf(type, period), { access: "private", useCache: false });
    if (!res || !res.stream) return null;
    return JSON.parse(await new Response(res.stream).text());
  } catch {
    return null;
  }
}

// [{ type, period, lockedAt }] newest first (lockedAt from blob upload time).
// fresh=true skips the per-instance cache (tab right after locking, keep-warm).
export async function listLocks({ fresh = false } = {}) {
  if (!fresh && listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.locks;
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor });
    for (const b of page.blobs) {
      const m = b.pathname.match(/^reports\/([^/]+)\/(.+)\.json$/);
      if (m) out.push({ type: m[1], period: m[2], lockedAt: new Date(b.uploadedAt).toISOString() });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const locks = out.sort((a, b) => b.lockedAt.localeCompare(a.lockedAt));
  listCache = { at: Date.now(), locks };
  return locks;
}
