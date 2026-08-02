/**
 * pages/api/data.js
 * GET /api/data?months=1,2,3&projects=GTC,ABC
 * 
 * Protected endpoint — requires valid session.
 * Fetches Google Sheets, transforms data, returns JSON.
 * If role='client', automatically filters to user's assigned project.
 */
import { getSession } from "../../lib/auth";
import { fetchSheet } from "../../lib/sheets";
import { transformLTL } from "../../lib/transform-ltl";
import { transformFTL } from "../../lib/transform-ftl";
import { transformTachTrip } from "../../lib/transform-tach-trip";
import { transformAIInsights } from "../../lib/transform-ai-insights";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth check ──
  const session = await getSession(req, res);
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const role = session.user.role || "manager";
  const userProject = session.user.project || null;

  // ── Parse query filters ──
  let months = null;
  let projects = null;

  if (req.query.months) {
    months = req.query.months
      .split(",")
      .map(Number)
      .filter((n) => !isNaN(n) && n >= 1 && n <= 12);
    if (months.length === 0) months = null;
  }

  if (req.query.projects) {
    projects = req.query.projects.split(",").filter(Boolean);
    if (projects.length === 0) projects = null;
  }

  // ── Enforce client project restriction ──
  if (role === "client" && userProject) {
    projects = [userProject];
  }

  try {
    // ── Fetch raw data from Google Sheets ──
    const [rawLTL, rawFTL, masterVehicle, rawDamage] = await Promise.all([
      fetchSheet("raw_ontime"),
      fetchSheet("Raw_FTL").catch(() => []),
      fetchSheet("Master data xe").catch(() => []),
      fetchSheet("raw_damage").catch(() => []),
    ]);

    // ── Transform ──
    const ltlData       = transformLTL(rawLTL, { months, projects }, rawDamage);
    const ftlData       = transformFTL(rawFTL, masterVehicle, { months, projects });
    const tachTripData  = transformTachTrip(rawLTL);
    const aiInsights    = transformAIInsights(rawLTL);

    // ── Overview: all-time totals (no filter) ──
    const overviewLTL = transformLTL(rawLTL, {}, rawDamage);
    const overviewFTL = transformFTL(rawFTL, masterVehicle, {});

    return res.status(200).json({
      ok: true,
      user: { role, project: userProject },
      filters: { months, projects },
      ltl: ltlData,
      ftl: ftlData,
      tachTrip: tachTripData,
      aiInsights,
      overview: {
        ltl: {
          totalOrders: overviewLTL.totalOrders,
          totalWeight: overviewLTL.totalWeight,
          ontimePct: overviewLTL.ontimePct,
          totalBroken: overviewLTL.totalBroken,
        },
        ftl: {
          totalTrips: overviewFTL.totalTrips,
          totalOrders: overviewFTL.totalOrders,
          totalWeight: overviewFTL.totalWeight,
        },
        allProjectsLTL: ltlData.allProjects,
        allProjectsFTL: ftlData.allProjects,
      },
    });
  } catch (err) {
    console.error("[/api/data] Error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
