/**
 * pages/api/cron/build-snapshot.js
 * Rebuilds the LTL snapshot in Vercel Blob (lib/ltl-snapshot.js).
 * Called by:
 *  - cloud-scraper/run_scrapers.sh right after raw_ontime syncs (freshest),
 *  - Vercel Cron 09:00 / 13:00 / 18:00 VN as a fallback (vercel.json).
 * Replaces the old /api/cron/cache-refresh (flush + warm in-memory cache).
 */
import { buildLtlSnapshot, loadLtlBase } from "../../../lib/ltl-snapshot";
import { logAction } from "../../../lib/audit-log";
import { validateRows } from "../../../lib/data-validator";

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

    // Validation hook (Phase 1 Step 2): LOG-only by default, never blocks cron.
    try {
      const freshBase = await loadLtlBase().catch(() => null);
      if (freshBase?.ltlRows?.length) {
        const vr = validateRows("raw_ontime", freshBase.ltlRows);
        if (vr.tallies.invalid > 0 || vr.tallies.warningCount > 0) {
          console.warn(
            `[build-snapshot] data quality: ${vr.tallies.invalid} invalid rows, ${vr.tallies.warningCount} warnings`
          );
        }
      }
    } catch (valErr) {
      console.warn("[build-snapshot] validation check failed (non-blocking):", valErr.message);
    }

    const tookMs = Date.now() - started;
    await logAction({
      actor: req.headers["x-caller"] ? `snapshot:${req.headers["x-caller"]}` : "cron:build-snapshot",
      action: "snapshot.build",
      target: "ltl",
      details: { ...stats, tookMs },
    }).catch(() => {});

    // Fire-and-forget: dispatch anomaly notifications to GTalk after rebuild.
    if (process.env.GTALK_OA_WEBHOOK_URL) {
      const dispatchOrigin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "https://logicore-app.vercel.app";
      const dispatchSecret = process.env.SNAPSHOT_SECRET;
      if (dispatchSecret) {
        fetch(`${dispatchOrigin}/api/notifications/gtalk-dispatch`, {
          method: "POST",
          headers: { "x-snapshot-secret": dispatchSecret, "Content-Type": "application/json" },
          body: "{}",
        }).catch((e) => console.warn("[build-snapshot] gtalk-dispatch failed (non-blocking):", e.message));
      }
    }

    // Warm /api/data after build so the first dashboard load finds a hot
    // instance with the new snapshot already in memory. Fire-and-forget.
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://logicore-app.vercel.app";
    const secret = process.env.SNAPSHOT_SECRET;
    if (secret) {
      fetch(`${origin}/api/data?warm=1`, {
        headers: { "x-snapshot-secret": secret },
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, ...stats, tookMs });
  } catch (err) {
    console.error("[/api/cron/build-snapshot] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
