/**
 * pages/api/ontime-by-project.js
 * GET — lightweight endpoint for the "Vận hành SD3" KPI panel: ontime %
 * per project (all-time, no month/project filter), so it can be joined
 * client-side with each project's PIC to build a per-staff KPI view
 * without pulling the full (>4MB) /api/data payload.
 */
import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { isDMClient, isLTLRow, isFromJuly2026 } from "../../lib/dm-clients";
import { transformLTL } from "../../lib/transform-ltl";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("operations")) {
    return res.status(403).json({ error: "Bạn không có quyền xem Vận hành SD3" });
  }

  try {
    const ltlSheetId = process.env.SHEET_ID_LTL;
    const rawLTL = await fetchSheet("raw_ontime", ltlSheetId).catch(() => []);
    if (!rawLTL || rawLTL.length === 0) {
      return res.status(200).json({ ok: true, ontimeByProject: {} });
    }

    const filteredLTL = rawLTL.filter(
      (r) => isDMClient(r["client_name"]) && isFromJuly2026(r["pickup_time"]) && isLTLRow(r)
    );
    const { ontimeByProject } = transformLTL(filteredLTL, {}, []);
    return res.status(200).json({ ok: true, ontimeByProject });
  } catch (err) {
    console.error("[/api/ontime-by-project] Error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
