/**
 * pages/api/rillnet-cs-sync.js
 * POST /api/rillnet-cs-sync
 * Receives CS-confirmed DM damage cases (CS tick 💰) extracted from
 * Rillnet's _LB.bevo.rows via CDP. Full replace each run.
 *
 * Body: { records: [...], rillnetCount: N }
 *   records    — array of case objects (see lib/rillnet-cs-sync.js)
 *   rillnetCount — how many cases Rillnet's LB reported (for audit log)
 *
 * Auth: X-Sync-Secret header (same secret as /api/rillnet-sync).
 */
import { syncCsTickCases } from "../../lib/rillnet-cs-sync";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-sync-secret"];
  if (!process.env.RILLNET_SYNC_SECRET || secret !== process.env.RILLNET_SYNC_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { records, rillnetCount } = req.body || {};
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "Missing records[]" });
  }

  try {
    const result = await syncCsTickCases(records);
    const mismatch = rillnetCount != null && rillnetCount !== result.synced;
    await logAction({
      actor: "rillnet-scraper",
      action: "rillnet.cs_tick_sync",
      target: `${result.synced} CS tick cases`,
      details: { rillnetCount, pushed: result.synced, mismatch },
    });
    return res.status(200).json({ ok: true, ...result, rillnetCount, mismatch });
  } catch (err) {
    console.error("[/api/rillnet-cs-sync] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
