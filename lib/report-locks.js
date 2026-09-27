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

export async function saveLock(type, period, report, lockedBy) {
  const lock = { type, period, lockedAt: new Date().toISOString(), lockedBy: lockedBy || "", report };
  await put(pathOf(type, period), JSON.stringify(lock), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
  });
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
export async function listLocks() {
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
  return out.sort((a, b) => b.lockedAt.localeCompare(a.lockedAt));
}
