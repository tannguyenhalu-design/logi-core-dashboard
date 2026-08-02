/**
 * pages/api/damage-claims.js
 * Claims-workflow tracking for damage/broken cases — anyone with access to
 * the LTL tab can view and update. GET returns all claims keyed by
 * order_code; POST upserts one claim (assignee/status/notes).
 */
import { getSession } from "../../lib/auth";
import { getAllClaims, upsertClaim, CLAIM_STATUSES } from "../../lib/damage-claims";
import { logAction } from "../../lib/audit-log";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("ltl")) {
    return res.status(403).json({ error: "Bạn không có quyền xem LTL Dashboard" });
  }

  if (req.method === "GET") {
    try {
      const claims = await getAllClaims();
      return res.status(200).json({ ok: true, claims, statuses: CLAIM_STATUSES });
    } catch (err) {
      console.error("[/api/damage-claims] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { orderCode, status, assignee, notes } = req.body || {};
      if (!orderCode) return res.status(400).json({ error: "Missing orderCode" });
      if (status && !CLAIM_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const actor = session.user.name || session.user.email;
      const claim = await upsertClaim({ orderCode, status, assignee, notes, actor });
      await logAction({
        actor,
        action: "update_damage_claim",
        target: orderCode,
        details: { status: claim.status, assignee: claim.assignee },
      });
      return res.status(200).json({ ok: true, claim });
    } catch (err) {
      console.error("[/api/damage-claims] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
