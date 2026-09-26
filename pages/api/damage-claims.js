/**
 * pages/api/damage-claims.js
 * Claims-workflow tracking for damage/broken cases. Anyone with the LTL tab
 * can view (GET, keyed by order_code); only manager + sd3 can update (POST:
 * status / assignee / a new note appended to the case log) — 2026-09-26.
 */
import { getSession } from "../../lib/auth";
import { getAllClaims, upsertClaim, CLAIM_STATUSES } from "../../lib/damage-claims";
import { logAction } from "../../lib/audit-log";

const CLAIM_EDIT_ROLES = ["manager", "sd3"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("ltl")) {
    return res.status(403).json({ error: "Bạn không có quyền xem LTL Dashboard" });
  }
  const canEdit = CLAIM_EDIT_ROLES.includes(session.user.role);

  if (req.method === "GET") {
    try {
      const claims = await getAllClaims();
      return res.status(200).json({ ok: true, claims, statuses: CLAIM_STATUSES, canEdit });
    } catch (err) {
      console.error("[/api/damage-claims] GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    if (!canEdit) return res.status(403).json({ error: "Chỉ Manager và SD3 được cập nhật ca hư hỏng" });
    try {
      const { orderCode, status, assignee, note } = req.body || {};
      if (!orderCode) return res.status(400).json({ error: "Missing orderCode" });
      if (status && !CLAIM_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      if (note && String(note).length > 1000) return res.status(400).json({ error: "Ghi chú tối đa 1.000 ký tự" });
      const actor = session.user.name || session.user.email;
      const claim = await upsertClaim({ orderCode, status, assignee, note, actor });
      await logAction({
        actor,
        action: "update_damage_claim",
        target: orderCode,
        details: { status: claim.status, assignee: claim.assignee, note: note ? String(note).slice(0, 200) : undefined },
      });
      return res.status(200).json({ ok: true, claim });
    } catch (err) {
      console.error("[/api/damage-claims] POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
