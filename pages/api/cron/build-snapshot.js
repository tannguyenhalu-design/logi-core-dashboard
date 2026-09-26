/**
 * pages/api/cron/build-snapshot.js
 * Rebuilds the LTL snapshot in Vercel Blob (lib/ltl-snapshot.js).
 * Called by:
 *  - cloud-scraper/run_scrapers.sh right after raw_ontime syncs (freshest),
 *  - Vercel Cron 09:00 / 13:00 / 18:00 VN as a fallback (vercel.json).
 * Replaces the old /api/cron/cache-refresh (flush + warm in-memory cache).
 */
import { buildLtlSnapshot } from "../../../lib/ltl-snapshot";
import { logAction } from "../../../lib/audit-log";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // CRON_SECRET: sent automatically by Vercel Cron. SNAPSHOT_SECRET: shared
  // with the Railway scraper only (production CRON_SECRET is a Sensitive
  // env var and can't be copied out to Railway).
  const cronSecret = process.env.CRON_SECRET;
  const snapshotSecret = process.env.SNAPSHOT_SECRET;
  const auth = req.headers.authorization;
  const authorized =
    (cronSecret && (auth === `Bearer ${cronSecret}` || req.headers["x-internal-refresh"] === cronSecret)) ||
    (snapshotSecret && req.headers["x-snapshot-secret"] === snapshotSecret);
  if (!authorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const started = Date.now();
  try {
    const stats = await buildLtlSnapshot();
    const tookMs = Date.now() - started;
    await logAction({
      actor: req.headers["x-caller"] ? `snapshot:${req.headers["x-caller"]}` : "cron:build-snapshot",
      action: "snapshot.build",
      target: "ltl",
      details: { ...stats, tookMs },
    }).catch(() => {});
    return res.status(200).json({ ok: true, ...stats, tookMs });
  } catch (err) {
    console.error("[/api/cron/build-snapshot] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
