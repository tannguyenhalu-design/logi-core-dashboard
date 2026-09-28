/**
 * pages/api/system-health.js
 * Manager-only: health of every data source behind the LTL dashboard
 * (scraper heartbeat + data freshness) for the "Trạng thái hệ thống" tab.
 */
import { getSession } from "../../lib/auth";
import { getSystemHealth } from "../../lib/system-health";
import { isWarmPing, answerWarm } from "../../lib/warm";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "private, no-store");
  if (isWarmPing(req)) return answerWarm(res, () => getSystemHealth());
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.role !== "manager") {
    return res.status(403).json({ error: "Chỉ Manager mới xem được trạng thái hệ thống" });
  }
  try {
    return res.status(200).json(await getSystemHealth());
  } catch (err) {
    console.error("[/api/system-health] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
