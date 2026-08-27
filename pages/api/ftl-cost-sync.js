/**
 * pages/api/ftl-cost-sync.js
 * POST /api/ftl-cost-sync — receives "Chi phí phát sinh" rows scraped from
 * portal.ghn.vn/b2b/ftl-cost/incidental-costs, same pattern as
 * /api/rillnet-sync. Not a user-session endpoint — shared-secret header
 * since the scraper runs standalone on Railway.
 */
import { syncFTLCosts } from "../../lib/ftl-cost-sync";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-sync-secret"];
  if (!process.env.FTL_COST_SYNC_SECRET || secret !== process.env.FTL_COST_SYNC_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { records } = req.body || {};
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "Missing records[]" });
  }

  try {
    const result = await syncFTLCosts(records);
    await logAction({
      actor: "ftl-cost-scraper",
      action: "ftl_cost.sync",
      target: `${result.synced} cost rows`,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/ftl-cost-sync] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
