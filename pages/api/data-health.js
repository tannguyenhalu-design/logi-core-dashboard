/**
 * pages/api/data-health.js — Per-dataset data quality dashboard.
 *
 * GET /api/data-health
 * Returns: { ok, checkedAt, overall_quality, quality_score, quality_breakdown, datasets[] }
 *
 * Each dataset entry: { dataset, display_name, last_updated, row_count,
 *   duplicates, missing_rate, schema_status, freshness, quality_score, status }
 *
 * Access: manager + sd3 only.
 */
import { getSession } from "../../lib/auth";
import { getSystemHealth } from "../../lib/system-health";
import { loadLtlBase } from "../../lib/ltl-snapshot";
import { computeQualityScore } from "../../lib/data-health";

const ALLOWED_ROLES = ["manager", "sd3"];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // Allow internal cron/scraper calls with SNAPSHOT_SECRET
  const snapshotSecret = process.env.SNAPSHOT_SECRET;
  const isInternalCall =
    snapshotSecret && req.headers["x-snapshot-secret"] === snapshotSecret;

  if (!isInternalCall) {
    const session = await getSession(req, res);
    if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  try {
    const [health, base] = await Promise.all([
      getSystemHealth(),
      loadLtlBase().catch(() => null),
    ]);

    const qs = computeQualityScore(base);

    // Build per-dataset rows from system health sources + quality info
    const datasets = (health.sources || []).map((s) => {
      const facts = s.facts || {};
      const isRawOntime = s.key === "raw_ontime";
      return {
        dataset: s.key,
        display_name: s.name,
        last_updated: facts.lastSyncedAt || facts.builtAt || null,
        row_count: facts.ltlRows ?? facts.totalRows ?? facts.lastCaseCount ?? null,
        new_rows: null,
        duplicates: isRawOntime ? (facts.duplicateOrderCodes ?? null) : null,
        missing_rate: isRawOntime ? _missingRate(facts) : null,
        schema_status: "defined",
        freshness: s.level,
        quality_score: isRawOntime ? qs.score : null,
        status: s.level,
      };
    });

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      overall_quality: qs.status,
      quality_score: qs.score,
      quality_breakdown: qs.breakdown,
      datasets,
      alertCount: health.alertCount || 0,
    });
  } catch (err) {
    console.error("[/api/data-health] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function _missingRate(facts) {
  const total = facts.ltlRows || facts.totalRows;
  if (!total) return null;
  const missing =
    (facts.emptyOrderCode || 0) +
    (facts.emptyProject || 0) +
    (facts.nullPickupTimes || 0);
  return Math.round((missing / total) * 10000) / 10000;
}
