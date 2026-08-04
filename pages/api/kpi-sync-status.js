/**
 * pages/api/kpi-sync-status.js
 * GET — "last synced X ago" for the KPI portal → Sheet pipeline, so a
 * silent failure (expired local Chrome session, laptop off, etc.) shows
 * up in the UI instead of the numbers just quietly going stale.
 */
import { getSession } from "../../lib/auth";
import { getLastActionTime } from "../../lib/audit-log";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager" && !(session.user.tabs || []).includes("operations")) {
    return res.status(403).json({ error: "Bạn không có quyền xem Vận hành SD3" });
  }

  try {
    const lastSyncAt = await getLastActionTime("kpi.sync");
    let status = "never";
    let hoursAgo = null;
    if (lastSyncAt) {
      hoursAgo = (Date.now() - new Date(lastSyncAt).getTime()) / (1000 * 60 * 60);
      status = hoursAgo <= 26 ? "ok" : hoursAgo <= 50 ? "stale" : "critical";
    }
    return res.status(200).json({ ok: true, lastSyncAt, hoursAgo, status });
  } catch (err) {
    console.error("[/api/kpi-sync-status] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
