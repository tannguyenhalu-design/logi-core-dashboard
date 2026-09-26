/**
 * pages/api/scraper-heartbeat.js
 * Receives per-step results from cloud-scraper/report_health.py after every
 * scraper run (ok / session_expired / error) → lib/system-health.js.
 * Auth: SNAPSHOT_SECRET (shared with Railway, same as build-snapshot).
 */
import { recordHeartbeat } from "../../lib/system-health";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.SNAPSHOT_SECRET;
  if (!secret || req.headers["x-snapshot-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const body = req.body || {};
  if (!Array.isArray(body.steps)) return res.status(400).json({ error: "steps[] required" });
  try {
    const saved = await recordHeartbeat(body);
    return res.status(200).json({ ok: true, updatedAt: saved.updatedAt });
  } catch (err) {
    console.error("[/api/scraper-heartbeat] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
