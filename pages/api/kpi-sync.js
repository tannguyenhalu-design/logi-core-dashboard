/**
 * pages/api/kpi-sync.js
 * POST /api/kpi-sync — receives rows scraped locally from the B2B
 * Intelligence portal and writes matching projects' revenue/last-month
 * actuals. Not a user-session endpoint (the scraper runs standalone on
 * someone's machine, not through a browser login) — authenticated via a
 * shared secret header instead.
 */
import { syncRevenueByClientId } from "../../lib/kpi-sync";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-sync-secret"];
  if (!process.env.KPI_SYNC_SECRET || secret !== process.env.KPI_SYNC_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: "Missing records[]" });
  }

  try {
    const result = await syncRevenueByClientId(records, "kpi-scraper");
    await logAction({
      actor: "kpi-scraper",
      action: "kpi.sync",
      target: `${result.matched} projects`,
      details: { updated: result.updated.map((u) => u.name) },
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/kpi-sync] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
