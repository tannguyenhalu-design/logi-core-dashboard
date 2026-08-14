/**
 * pages/api/rillnet-sync.js
 * POST /api/rillnet-sync — receives per-order damage/breakage records
 * scraped locally from Rillnet (rillnet-app.vercel.app) via CDP, same
 * pattern as /api/kpi-sync. Not a user-session endpoint — authenticated
 * via a shared secret header since the scraper runs standalone.
 */
import { syncDamageCauses } from "../../lib/rillnet-sync";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-sync-secret"];
  if (!process.env.RILLNET_SYNC_SECRET || secret !== process.env.RILLNET_SYNC_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { records } = req.body || {};
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "Missing records[]" });
  }

  try {
    const result = await syncDamageCauses(records);
    await logAction({
      actor: "rillnet-scraper",
      action: "rillnet.sync",
      target: `${result.synced} damage cases`,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/rillnet-sync] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
