/**
 * pages/api/cron/warm.js — Vercel Cron keep-warm (2026-10-04).
 * Loads the snapshot blobs into this instance's memory so the next real
 * request skips the blob-read cold path (~300–800ms saving).
 * Called by Vercel Cron every ~1h during evening/night VN hours when the
 * Railway keep_warm.sh (07:00–20:00 VN) is not running.
 * Auth: Vercel Cron sends Authorization: Bearer $CRON_SECRET automatically.
 */
import { loadDefaultBody, loadLtlBase } from "../../../lib/ltl-snapshot";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const snapshotSecret = process.env.SNAPSHOT_SECRET;
  const auth = req.headers.authorization;
  const authorized =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (snapshotSecret && req.headers["x-snapshot-secret"] === snapshotSecret);
  if (!authorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const started = Date.now();
  try {
    await Promise.all([loadDefaultBody(), loadLtlBase()]);
    return res.status(200).json({ ok: true, ms: Date.now() - started });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
