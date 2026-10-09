/**
 * pages/api/data/trend.js
 * GET /api/data/trend?projects=Aqua+B2C,LG+LTL&origin=...
 * Returns 4-week weekly trend (SLA %, bể vỡ %, hàng hoàn %) + province decline
 * table for the "Historical Trend & Incident Tracker" panel (PHẦN 3).
 *
 * Lighter than /api/data: no full computeDashboard — reads the base snapshot
 * and runs computeWeeklyTrend directly.
 */
import { getSession } from "../../../lib/auth";
import { getCached, setCached } from "../../../lib/mem-cache";
import { loadLtlBase } from "../../../lib/ltl-snapshot";
import { computeWeeklyTrend } from "../../../lib/weekly-trend";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  res.setHeader("Cache-Control", "private, no-store");

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  const { projects: projectsParam, origin } = req.query;
  const projects = projectsParam
    ? projectsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // Cache key: scoped per user-visible project selection.
  const cacheKey = `trend:${projects.sort().join("|")}:${origin || ""}`;
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);

  const base = await loadLtlBase();
  if (!base) return res.status(503).json({ error: "Snapshot unavailable" });

  const result = computeWeeklyTrend(base.ltlRows, base.rawDamageCauses, { projects, origin });

  const body = { ok: true, ...result };
  setCached(cacheKey, body, 60_000);
  return res.status(200).json(body);
}
