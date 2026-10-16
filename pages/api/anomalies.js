/**
 * pages/api/anomalies.js — GET active anomalies from the LTL snapshot.
 *
 * GET /api/anomalies?severity=HIGH&limit=20
 *   severity: CRITICAL | HIGH | MEDIUM | LOW | INFO (default: all)
 *   limit: max results (default 50)
 *
 * Returns: { ok, checkedAt, total, anomalies[] }
 * Access: manager + sd3 (cs/client blocked)
 */
import { getSession } from "../../lib/auth";
import { loadLtlBase } from "../../lib/ltl-snapshot";
import { scanAnomalies } from "../../lib/anomaly-detector";

const ALLOWED_ROLES = ["manager", "sd3"];
const VALID_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const minSeverity = String(req.query.severity || "").toUpperCase() || null;
  if (minSeverity && !VALID_SEVERITIES.includes(minSeverity)) {
    return res.status(400).json({ error: `Invalid severity. Use: ${VALID_SEVERITIES.join(", ")}` });
  }

  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));

  try {
    const base = await loadLtlBase().catch(() => null);
    const anomalies = scanAnomalies(base, { minSeverity, maxResults: limit });

    const summary = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    for (const a of anomalies) summary[a.severity] = (summary[a.severity] || 0) + 1;

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      dataAsOf: base?.builtAt || null,
      total: anomalies.length,
      summary,
      anomalies,
    });
  } catch (err) {
    console.error("[/api/anomalies] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
